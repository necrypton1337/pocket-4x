# Генератор графики игры в Blender: модели строятся кодом и рендерятся в спрайты.
# Запуск: blender -b -P tools/blender/render_assets.py -- <папка_вывода> [фильтр]
# Камера ортографическая, наклонена на TILT от вертикали — так же, как раскладка карты в игре.
import bpy, bmesh, math, random, sys, os, json
from mathutils import Vector, Euler

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else 'assets'
ONLY = ARGS[1] if len(ARGS) > 1 else ''
TILT = math.radians(40)
K = math.cos(TILT)
PX = 192  # пикселей на единицу мира (радиус гекса = 1)
os.makedirs(OUT, exist_ok=True)
MANIFEST = {}
man_path = os.path.join(OUT, 'manifest.json')
if os.path.exists(man_path):
    MANIFEST = json.load(open(man_path)).get('sprites', {})

# ---------------- сцена ----------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.62, 0.70, 0.82, 1)
    bg.inputs[1].default_value = 0.55
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    sun.data.color = (1.0, 0.95, 0.88)
    sun.rotation_euler = Euler((math.radians(34), math.radians(-14), math.radians(-35)))
    sc.collection.objects.link(sun)
    return sc


def camera(sc, w, y0, y1):
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    h = y1 - y0
    cam.data.ortho_scale = max(w, h)
    sc.render.resolution_x = int(round(w * PX))
    sc.render.resolution_y = int(round(h * PX))
    sc.render.resolution_percentage = 100
    cam.rotation_euler = Euler((TILT, 0, 0))
    d = Vector((0, math.sin(TILT), -math.cos(TILT)))
    up = Vector((0, math.cos(TILT), math.sin(TILT)))
    cy = (y0 + y1) / 2
    cam.location = up * cy - d * 20
    cam.data.clip_end = 100
    sc.collection.objects.link(cam)
    sc.camera = cam
    return {'w': sc.render.resolution_x, 'h': sc.render.resolution_y, 'ax': w / 2 * PX, 'ay': y1 * PX}


def render(sc, name, frame, kind):
    path = os.path.join(OUT, name + '.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    MANIFEST[name] = {**frame, 'px': PX, 'kind': kind}
    print('RENDERED', name)


def shadow_catcher(size=4):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, -0.01))
    p = bpy.context.active_object
    p.is_shadow_catcher = True
    return p

# ---------------- материалы ----------------

def mat(name, color, rough=0.7, metal=0.0, emit=None, emit_str=0.0, alpha=1.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_str
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def srgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def noise_mat(name, c1, c2, scale=3.0, rough=0.85, bump=0.4, seed=0.0, c3=None, detail=6.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 7.3, seed * 3.1, seed * 1.7)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = 0.6
    nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*c1, 1)
    ramp.color_ramp.elements[1].position = 0.68
    ramp.color_ramp.elements[1].color = (*c2, 1)
    if c3:
        e = ramp.color_ramp.elements.new(0.52)
        e.color = (*c3, 1)
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    n2 = nt.nodes.new('ShaderNodeTexNoise')
    n2.inputs['Scale'].default_value = scale * 6
    nt.links.new(mp.outputs['Vector'], n2.inputs['Vector'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    nt.links.new(n2.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


def snow_rock_mat(name, rock, snow_h=0.55):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 6
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'MULTIPLY_ADD'
    add.inputs[1].default_value = 0.18
    nt.links.new(n.outputs['Fac'], add.inputs[0])
    nt.links.new(sep.outputs['Z'], add.inputs[2])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = snow_h
    ramp.color_ramp.elements[0].color = (*rock, 1)
    ramp.color_ramp.elements[1].position = snow_h + 0.05
    ramp.color_ramp.elements[1].color = (0.92, 0.94, 0.98, 1)
    nt.links.new(add.outputs['Value'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.8
    n2 = nt.nodes.new('ShaderNodeTexNoise')
    n2.inputs['Scale'].default_value = 14
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.6
    nt.links.new(n2.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

# ---------------- геометрия ----------------

def apply(o, m):
    if o.data.materials:
        o.data.materials[0] = m
    else:
        o.data.materials.append(m)
    return o


def shade_smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def cube(loc, size, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return apply(o, m)


def cyl(loc, r, h, m, verts=16, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object
    if verts > 8:
        shade_smooth(o)
    return apply(o, m)


def cone(loc, r, h, m, verts=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0, depth=h, location=loc, rotation=rot)
    return apply(bpy.context.active_object, m)


def sphere(loc, r, m, scale=(1, 1, 1), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    shade_smooth(o)
    return apply(o, m)


def displace(o, strength=0.15, size=0.5, seed=0):
    tex = bpy.data.textures.new('d%d' % seed, 'CLOUDS')
    tex.noise_scale = size
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = 3
    sub.render_levels = 3
    d = o.modifiers.new('disp', 'DISPLACE')
    d.texture = tex
    d.strength = strength
    d.texture_coords = 'GLOBAL'
    tex.noise_basis = 'ORIGINAL_PERLIN'
    o.location.x += 0  # глобальные координаты + seed через смещение текстуры
    d.texture_coords_object = None
    return o


def heightfield(fn, m, radius=0.86, res=48, name='hf'):
    import mathutils
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res, y_segments=res, size=radius)
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        v.co.z = max(0.0, fn(x, y)) - 0.02
    # убираем всё за пределами круга
    out = [f for f in bm.faces if f.calc_center_median().xy.length > radius]
    bmesh.ops.delete(bm, geom=out, context='FACES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for p in me.polygons:
        p.use_smooth = True
    return apply(o, m)


def ground_plane(m, size=2.8):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    return apply(bpy.context.active_object, m)

# ---------------- клетки ----------------

GROUND = {
    'grass':  (srgb('#3f7f3e'), srgb('#6a9a45'), srgb('#557f3a')),
    'plains': (srgb('#8f8a4a'), srgb('#b6a45f'), srgb('#9c9452')),
    'desert': (srgb('#b48552'), srgb('#d7b07a'), srgb('#c49a62')),
    'tundra': (srgb('#8fa1a0'), srgb('#d6e0e2'), srgb('#aab8b6')),
    'forest': (srgb('#2c4a2c'), srgb('#4a6b38'), srgb('#3a5a30')),
    'hills':  (srgb('#6f6248'), srgb('#9a8a62'), srgb('#857552')),
    'mountain': (srgb('#5c5660'), srgb('#7f7884'), srgb('#6b6570')),
    'water':  (srgb('#173f63'), srgb('#24577f'), srgb('#1d4a70')),
    'shallow': (srgb('#2a6f8a'), srgb('#3f8fa3'), srgb('#357f98')),
}


def render_ground(t, v):
    sc = reset()
    c1, c2, c3 = GROUND[t]
    water = t in ('water', 'shallow')
    m = noise_mat(f'g{t}{v}', c1, c2, scale=2.2 if water else 3.5, rough=0.25 if water else 0.9,
                  bump=0.25 if water else 0.5, seed=v + 1, c3=c3)
    ground_plane(m)
    if t == 'desert':
        for i in range(3):
            o = sphere((random.uniform(-0.8, 0.8), random.uniform(-0.6, 0.6), -0.05), 0.5, m, scale=(1.4, 0.5, 0.12))
    if t == 'tundra':
        snow = mat('snow', srgb('#e8eef2'), 0.6)
        for i in range(5):
            sphere((random.uniform(-0.9, 0.9), random.uniform(-0.7, 0.7), 0), random.uniform(0.08, 0.18), snow, scale=(1.6, 1, 0.25))
    fr = camera(sc, 2.4, -1.2 * K, 1.2 * K)
    render(sc, f'ground_{t}_{v}', fr, 'ground')


def tree(x, y, s, m_leaf, m_leaf2, m_trunk, kind):
    if kind == 'fung':
        cyl((x, y, 0.18 * s), 0.035 * s, 0.36 * s, m_trunk, verts=8)
        sphere((x, y, 0.38 * s), 0.17 * s, m_leaf2, scale=(1, 1, 0.45))
    else:
        cyl((x, y, 0.08 * s), 0.03 * s, 0.16 * s, m_trunk, verts=6)
        cone((x, y, 0.3 * s), 0.17 * s, 0.32 * s, m_leaf, verts=7)
        cone((x, y, 0.46 * s), 0.12 * s, 0.26 * s, m_leaf, verts=7)


def render_prop(t, v):
    sc = reset()
    random.seed(t + str(v))
    shadow_catcher()
    if t == 'forest':
        m_leaf = mat('leaf', srgb('#23502e'), 0.8)
        m_leaf2 = mat('fung', srgb('#5b3f78'), 0.5, emit=srgb('#a070d0'), emit_str=0.15)
        m_trunk = mat('trunk', srgb('#4a3424'), 0.9)
        pts = []
        m_leaf3 = mat('leaf3', srgb('#2f6a3a'), 0.8)
        tries = 0
        while len(pts) < 17 and tries < 2000:
            tries += 1
            p = (random.uniform(-0.7, 0.7), random.uniform(-0.62, 0.66))
            if math.hypot(p[0], p[1] / 0.95) > 0.74:
                continue
            if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 0.03 for q in pts):
                pts.append(p)
        for (x, y) in sorted(pts, key=lambda p: -p[1]):
            kind = 'con'
            tree(x, y, random.uniform(0.62, 0.95), m_leaf if random.random() < 0.6 else m_leaf3, m_leaf2, m_trunk, kind)
    elif t == 'hills':
        import mathutils.noise as N
        m = noise_mat('rock', srgb('#6b5c45'), srgb('#9b8a66'), scale=4, seed=v, c3=srgb('#5c7a3a'))
        bumps = [(-0.3 + random.uniform(-0.1, 0.1), 0.18, 0.26, 0.5), (0.3, -0.02 + random.uniform(-0.1, 0.1), 0.22, 0.45),
                 (0.0, -0.38, 0.18, 0.38)]
        def fh(x, y):
            z = 0
            for (bx, by, h, r) in bumps:
                d = math.hypot(x - bx, y - by) / r
                if d < 1:
                    z = max(z, h * (math.cos(d * math.pi) + 1) / 2)
            return z + 0.03 * N.noise(Vector((x * 6 + v, y * 6, 0))) * (z > 0.01)
        heightfield(fh, m, radius=0.86)
    elif t == 'mountain':
        import mathutils.noise as N
        m = snow_rock_mat('mrock', srgb('#5f5866'), 0.62)
        peaks = [(-0.34 + random.uniform(-0.08, 0.08), 0.16, 0.8, 0.42), (0.32, 0.22 + random.uniform(-0.08, 0.08), 0.7, 0.4),
                 (0.02, -0.18, 1.25, 0.52)]
        def fm(x, y):
            z = 0
            for (px, py, h, r) in peaks:
                d = math.hypot(x - px, y - py) / r
                if d < 1:
                    z = max(z, h * (1 - d) ** 1.05)
            ridge = 1 - abs(N.noise(Vector((x * 7 + v * 3, y * 7, 0))))
            return z * (0.7 + 0.4 * ridge)
        heightfield(fm, m, radius=0.86, res=64)
    elif t == 'ruins':
        stone = noise_mat('stone', srgb('#a89f8a'), srgb('#d8d0bc'), scale=8, seed=v)
        cyl((0, 0, 0.02), 0.55, 0.04, stone, verts=6)
        for (x, y, h) in [(-0.3, 0.2, 0.45), (0.0, 0.28, 0.25), (0.3, 0.15, 0.55), (-0.25, -0.2, 0.18), (0.25, -0.25, 0.35)]:
            cyl((x, y, h / 2 + 0.04), 0.06, h, stone, verts=10)
        cube((0.05, 0.0, 0.08), (0.4, 0.12, 0.08), stone, rot=(0, 0, 0.4))
        glow = mat('glow', srgb('#f5d36a'), 0.4, emit=srgb('#ffd75a'), emit_str=2.0)
        sphere((0.0, 0.0, 0.18), 0.05, glow)
    elif t == 'ruins_done':
        stone = noise_mat('stone', srgb('#8a8270'), srgb('#b0a892'), scale=8, seed=v)
        cyl((0, 0, 0.02), 0.55, 0.04, stone, verts=6)
        for (x, y, h) in [(-0.3, 0.2, 0.25), (0.3, 0.15, 0.3), (0.25, -0.25, 0.15)]:
            cyl((x, y, h / 2 + 0.04), 0.06, h, stone, verts=10)
    elif t == 'nest':
        flesh = noise_mat('flesh', srgb('#3a1a14'), srgb('#6e2e20'), scale=6, rough=0.5, seed=v)
        o = sphere((0, 0, 0), 0.5, flesh, scale=(1.1, 0.9, 0.35))
        displace(o, 0.08, 0.3, v)
        egg = mat('egg', srgb('#d0602c'), 0.3, emit=srgb('#ff7a2a'), emit_str=0.8)
        for (x, y) in [(-0.12, 0.05), (0.1, 0.1), (0.02, -0.1), (0.18, -0.08)]:
            sphere((x, y, 0.17), 0.08, egg, scale=(0.8, 0.8, 1.1))
    fr = camera(sc, 2.4, -1.1 * K, 2.4)
    render(sc, f'prop_{t}_{v}', fr, 'prop')


def render_small(name):
    """Ресурсы и улучшения — небольшие объекты на клетке."""
    sc = reset()
    random.seed(name)
    shadow_catcher()
    if name == 'res_crystals':
        m = mat('cr', srgb('#7b6cf0'), 0.1, emit=srgb('#9a8cff'), emit_str=1.2, transmission=0.3)
        for i in range(6):
            a = i / 6 * 6.28
            bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.07, depth=random.uniform(0.25, 0.45),
                                            location=(math.cos(a) * 0.1, math.sin(a) * 0.1, 0.15),
                                            rotation=(math.cos(a) * 0.4, math.sin(a) * 0.4, 0))
            apply(bpy.context.active_object, m)
    elif name == 'res_geyser':
        rock = mat('gr', srgb('#5a4d42'), 0.9)
        o = cyl((0, 0, 0.04), 0.22, 0.08, rock, verts=10, r2=0.14)
        g = mat('gg', srgb('#ffe27a'), 0.3, emit=srgb('#ffd34a'), emit_str=4)
        cyl((0, 0, 0.25), 0.05, 0.4, g, verts=10, r2=0.09)
    elif name == 'res_fertile':
        soil = noise_mat('fs', srgb('#3a2616'), srgb('#5a3c22'), scale=14, rough=0.95)
        o = sphere((0, 0, 0), 0.26, soil, scale=(1.2, 1, 0.12))
        sprout = mat('sp', srgb('#6fcf4a'), 0.6)
        for i in range(9):
            x, y = random.uniform(-0.2, 0.2), random.uniform(-0.15, 0.15)
            cone((x, y, 0.06), 0.02, random.uniform(0.07, 0.12), sprout, verts=5)
    elif name == 'res_metals':
        rock = noise_mat('mr', srgb('#4a4448'), srgb('#6b6066'), scale=10)
        vein = mat('mv', srgb('#d08a3a'), 0.25, metal=1.0)
        for (x, y, r) in [(-0.08, 0.04, 0.13), (0.1, -0.02, 0.1), (0.0, -0.12, 0.08)]:
            o = sphere((x, y, r * 0.5), r, rock, scale=(1, 1, 0.7), seg=8)
        for (x, y) in [(-0.02, 0.0), (0.12, 0.05)]:
            cube((x, y, 0.1), (0.05, 0.05, 0.05), vein, rot=(0.5, 0.3, 0.2))
    elif name == 'res_plankton':
        g = mat('pl', srgb('#6af0d0'), 0.3, emit=srgb('#5affd8'), emit_str=2.5)
        for i in range(9):
            sphere((random.uniform(-0.25, 0.25), random.uniform(-0.2, 0.2), 0.01), random.uniform(0.02, 0.04), g)
    elif name == 'imp_farm':
        soil = mat('soil', srgb('#5a4228'), 0.95)
        crop = mat('crop', srgb('#b8c24a'), 0.8)
        cube((0, 0, 0.005), (0.9, 0.7, 0.01), soil, rot=(0, 0, 0.3))
        for i in range(-3, 4):
            o = cube((i * 0.12 * math.cos(0.3), i * 0.12 * math.sin(0.3), 0.03), (0.06, 0.62, 0.05), crop, rot=(0, 0, 0.3))
    elif name == 'imp_mine':
        steel = mat('st', srgb('#7a7f86'), 0.4, metal=0.8)
        roof = mat('rf', srgb('#a0522d'), 0.7)
        for (x, y) in [(-0.1, -0.1), (0.1, -0.1), (-0.1, 0.1), (0.1, 0.1)]:
            cyl((x, y, 0.2), 0.015, 0.4, steel, verts=6)
        cube((0, 0, 0.42), (0.26, 0.26, 0.04), steel)
        cyl((0, 0, 0.47), 0.06, 0.05, steel, verts=12, rot=(1.57, 0, 0))
        cube((0.25, 0.05, 0.07), (0.18, 0.14, 0.14), roof)
        rock = mat('rk', srgb('#5d564c'), 0.9)
        sphere((-0.25, 0.12, 0.0), 0.12, rock, scale=(1.2, 1, 0.6), seg=8)
    elif name == 'imp_lumber':
        wood = mat('wd', srgb('#8a6038'), 0.8)
        for i in range(4):
            cyl((-0.05 + i * 0.0, -0.1 + i * 0.07, 0.04 + (i % 2) * 0.05), 0.04, 0.4, wood, verts=10, rot=(0, 1.57, 0.2))
        for (x, y) in [(0.25, 0.15), (-0.2, 0.2), (0.15, -0.25)]:
            cyl((x, y, 0.03), 0.05, 0.06, wood, verts=10)
    fr = camera(sc, 1.0, -0.4 * K, 0.7)
    render(sc, name, fr, 'small')

# ---------------- города ----------------

STYLE = {
    'empire':     dict(main=srgb('#eef1f6'), accent=srgb('#d4af37'), trim=srgb('#3b6fe0'), ground=srgb('#cfc9bb')),
    'scientists': dict(main=srgb('#dfe9e8'), accent=srgb('#2ec4b6'), trim=srgb('#9fe9e1'), ground=srgb('#9fb7b2')),
    'believers':  dict(main=srgb('#a49c90'), accent=srgb('#7a1530'), trim=srgb('#f2d27a'), ground=srgb('#8c867c')),
    'colonists':  dict(main=srgb('#d9d2c0'), accent=srgb('#e8a33d'), trim=srgb('#6b7280'), ground=srgb('#a89676')),
    'minor':      dict(main=srgb('#e3d7b8'), accent=srgb('#7c8a5a'), trim=srgb('#8a5a3a'), ground=srgb('#a8996f')),
}


def building(style, x, y, s, sty, rnd):
    main = mat('main', sty['main'], 0.55)
    acc = mat('acc', sty['accent'], 0.45, metal=0.5 if style == 'empire' else 0.0)
    trim = mat('trim', sty['trim'], 0.4, emit=sty['trim'] if style in ('empire', 'scientists') else None, emit_str=0.6)
    if style == 'empire':
        h = rnd.uniform(0.22, 0.42) * s
        cube((x, y, h / 2), (0.14 * s, 0.14 * s, h), main)
        cone((x, y, h + 0.07 * s), 0.11 * s, 0.14 * s, acc, verts=4, rot=(0, 0, 0.785))
        cube((x, y - 0.071 * s, h * 0.6), (0.06 * s, 0.005, 0.05 * s), trim)
    elif style == 'scientists':
        glass = mat('glass', srgb('#bff5ee'), 0.05, transmission=0.85)
        r = rnd.uniform(0.1, 0.16) * s
        green = mat('green', srgb('#3f8f4a'), 0.8)
        sphere((x, y, 0.0), r * 0.7, green, scale=(1, 1, 0.5), seg=12)
        sphere((x, y, 0.0), r, glass, scale=(1, 1, 0.85))
        cyl((x, y, 0.01), r * 1.05, 0.02, trim, verts=24)
    elif style == 'believers':
        h = rnd.uniform(0.12, 0.18) * s
        cube((x, y, h / 2), (0.16 * s, 0.13 * s, h), main)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.13 * s, depth=0.16 * s, location=(x, y, h + 0.08 * s), rotation=(0, 0, 0.785))
        o = apply(bpy.context.active_object, acc)
        o.scale = (1.15, 0.95, 1)
        cube((x, y - 0.066 * s, h * 0.45), (0.035 * s, 0.003, 0.05 * s), trim)
    elif style == 'colonists':
        h = 0.1 * s
        cube((x, y, h / 2), (0.2 * s, 0.12 * s, h), main)
        cube((x, y, h + 0.005), (0.2 * s, 0.12 * s, 0.015), acc)
        if rnd.random() < 0.4:
            cyl((x + 0.06 * s, y, h + 0.12 * s), 0.006, 0.22 * s, mat('ant', srgb('#666'), 0.5), verts=6)
    else:
        sphere((x, y, 0.0), 0.11 * s, main, scale=(1, 1, 0.8), seg=12)
        cube((x, y - 0.1 * s, 0.03 * s), (0.04 * s, 0.01, 0.06 * s), trim)


def render_city(style, level):
    sc = reset()
    rnd = random.Random(style + str(level))
    shadow_catcher()
    sty = STYLE[style]
    plaza = noise_mat('plaza', sty['ground'], tuple(min(1, c * 1.2) for c in sty['ground']), scale=9, seed=level)
    cyl((0, 0, 0.005), [0.42, 0.58, 0.72][level - 1], 0.01, plaza, verts=32)
    count = [4, 7, 11][level - 1]
    pts = []
    tries = 0
    while len(pts) < count and tries < 500:
        tries += 1
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0.0, [0.3, 0.46, 0.6][level - 1])
        p = (math.cos(a) * r, math.sin(a) * r * 0.9)
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 0.05 for q in pts):
            pts.append(p)
    for (x, y) in sorted(pts, key=lambda p: -p[1]):
        building(style, x, y, 1.45 + 0.15 * (level - 1), sty, rnd)
    fr = camera(sc, 2.2, -1.0 * K, 2.0)
    render(sc, f'city_{style}_{level}', fr, 'city')


def render_landmark(style):
    """Столица: главное здание стиля."""
    sc = reset()
    shadow_catcher()
    sty = STYLE[style]
    main = mat('main', sty['main'], 0.45)
    acc = mat('acc', sty['accent'], 0.35, metal=0.6 if style == 'empire' else 0.1)
    trim = mat('trim', sty['trim'], 0.3, emit=sty['trim'], emit_str=1.5)
    if style == 'empire':
        cube((0, 0, 0.06), (0.36, 0.36, 0.12), main)
        cyl((0, 0, 0.5), 0.1, 0.8, main, verts=8, r2=0.07)
        cone((0, 0, 0.98), 0.09, 0.2, acc, verts=8)
        for (x, y) in [(-0.14, -0.14), (0.14, -0.14), (-0.14, 0.14), (0.14, 0.14)]:
            cyl((x, y, 0.22), 0.04, 0.3, main, verts=8)
            cone((x, y, 0.42), 0.045, 0.1, acc, verts=8)
        cube((0, -0.101, 0.6), (0.03, 0.005, 0.25), trim)
    elif style == 'scientists':
        glass = mat('glass', srgb('#c9fbf5'), 0.03, transmission=0.9)
        sphere((0, 0, 0), 0.32, glass, scale=(1, 1, 0.75))
        cyl((0, 0, 0.35), 0.03, 0.5, mat('st', srgb('#d0d8da'), 0.3, metal=0.8), verts=8)
        sphere((0, 0, 0.62), 0.06, trim)
    elif style == 'believers':
        cube((0, 0, 0.14), (0.28, 0.2, 0.28), main)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.2, depth=0.18, location=(0, 0, 0.37), rotation=(0, 0, 0.785))
        apply(bpy.context.active_object, acc).scale = (1.2, 0.9, 1)
        cube((0.0, 0.12, 0.35), (0.1, 0.1, 0.7), main)
        cone((0.0, 0.12, 0.83), 0.08, 0.28, acc, verts=4, rot=(0, 0, 0.785))
        cube((0, 0.069, 0.45), (0.03, 0.003, 0.06), trim)
    elif style == 'colonists':
        cyl((0, 0, 0.15), 0.18, 0.3, main, verts=16)
        cyl((0, 0, 0.31), 0.19, 0.03, acc, verts=16)
        cyl((0.0, 0.0, 0.55), 0.01, 0.45, mat('ant', srgb('#555'), 0.4), verts=6)
        sphere((0.0, 0.0, 0.78), 0.03, trim)
    fr = camera(sc, 1.0, -0.4 * K, 1.2)
    render(sc, f'capital_{style}', fr, 'small')


def render_walls(style):
    sc = reset()
    shadow_catcher()
    sty = STYLE[style]
    if style == 'scientists':
        dome = mat('dome', srgb('#7ff3e6'), 0.05, emit=srgb('#7ff3e6'), emit_str=0.25, transmission=0.95)
        o = sphere((0, 0, 0), 0.82, dome, scale=(1, 0.92, 0.45))
    else:
        stone = noise_mat('wall', tuple(c * 0.8 for c in sty['main']), sty['main'], scale=12)
        n = 20
        for i in range(n):
            a = i / n * 6.283
            x, y = math.cos(a) * 0.8, math.sin(a) * 0.72
            cube((x, y, 0.06), (0.24, 0.06, 0.12), stone, rot=(0, 0, a + 1.5708))
            if i % 5 == 0:
                cyl((x, y, 0.1), 0.06, 0.2, stone, verts=8)
    fr = camera(sc, 2.2, -1.0 * K, 2.0)
    render(sc, f'walls_{style}', fr, 'city')

# ---------------- юниты ----------------

TEAM = {
    'empire':     (srgb('#f1f4f9'), srgb('#2557d6'), srgb('#d4af37')),
    'scientists': (srgb('#dfe7e6'), srgb('#1fb3a5'), srgb('#9ff6ec')),
    'believers':  (srgb('#3b3a40'), srgb('#8c1c3a'), srgb('#e9d6b0')),
    'colonists':  (srgb('#c9b58b'), srgb('#e08a20'), srgb('#5b6470')),
    'minor':      (srgb('#8a9470'), srgb('#c7b37a'), srgb('#5a4630')),
}


def figure(prim, acc, glow, x=0, y=0, s=1.0, helmet='round', weapon='rifle', bulk=1.0, shield=False, cloak=False, cap=False):
    skin = mat('skin', srgb('#c99a78'), 0.6)
    dark = mat('dark', srgb('#2a2b30'), 0.5, metal=0.4)
    P = mat('p', prim, 0.5)
    A = mat('a', acc, 0.45)
    G = mat('g', glow, 0.3, emit=glow, emit_str=1.2)
    # ноги
    for dx in (-0.035, 0.035):
        cyl((x + dx * s * bulk, y, 0.09 * s), 0.03 * s * bulk, 0.18 * s, dark, verts=8)
    # корпус
    o = cyl((x, y, 0.26 * s), 0.075 * s * bulk, 0.18 * s, P, verts=12, r2=0.065 * s * bulk)
    cube((x, y - 0.03 * s, 0.29 * s), (0.12 * s * bulk, 0.04 * s, 0.09 * s), A)
    if bulk > 1.2:
        for dx in (-1, 1):
            sphere((x + dx * 0.1 * s * bulk, y, 0.33 * s), 0.05 * s * bulk, A, seg=12)
    if cloak:
        cyl((x, y + 0.01, 0.22 * s), 0.09 * s, 0.28 * s, mat('cl', srgb('#4a5a3a'), 0.9), verts=10, r2=0.05 * s)
    # голова / шлем
    if cap:
        sphere((x, y, 0.4 * s), 0.045 * s, skin)
        cyl((x, y, 0.44 * s), 0.05 * s, 0.025 * s, A, verts=12)
    elif helmet == 'visor':
        sphere((x, y, 0.41 * s), 0.055 * s * min(bulk, 1.3), P)
        cube((x, y - 0.045 * s, 0.415 * s), (0.07 * s, 0.01, 0.025 * s), G)
    else:
        sphere((x, y, 0.4 * s), 0.045 * s, skin)
        sphere((x, y, 0.425 * s), 0.052 * s, A, scale=(1, 1, 0.7))
    # оружие
    if weapon == 'rifle':
        cube((x + 0.06 * s, y - 0.06 * s, 0.28 * s), (0.02 * s, 0.2 * s, 0.025 * s), dark, rot=(0.3, 0, 0))
    elif weapon == 'long':
        cube((x + 0.06 * s, y - 0.09 * s, 0.3 * s), (0.018 * s, 0.32 * s, 0.022 * s), dark, rot=(0.15, 0, 0))
    elif weapon == 'cannon':
        cyl((x + 0.11 * s * bulk, y - 0.06 * s, 0.32 * s), 0.025 * s, 0.22 * s, dark, verts=10, rot=(1.4, 0, 0))
        sphere((x + 0.11 * s * bulk, y - 0.17 * s, 0.33 * s), 0.018 * s, G)
    if shield:
        cube((x - 0.02 * s, y - 0.1 * s, 0.25 * s), (0.16 * s, 0.02 * s, 0.26 * s), A)
        cube((x - 0.02 * s, y - 0.112 * s, 0.25 * s), (0.04 * s, 0.005, 0.18 * s), G)


def base_disc(acc):
    rim = mat('rim', srgb('#1a1d24'), 0.5)
    top = mat('top', acc, 0.35)
    cyl((0, 0, 0.012), 0.27, 0.024, rim, verts=32)
    cyl((0, 0, 0.026), 0.245, 0.008, top, verts=32)


def wheels(xs, ys, r, m):
    for x in xs:
        for y in ys:
            cyl((x, y, r), r, 0.05, m, verts=14, rot=(0, 1.5708, 0))


def vehicle(kind, prim, acc, glow):
    P = mat('p', prim, 0.45, metal=0.3)
    A = mat('a', acc, 0.4, metal=0.2)
    D = mat('d', srgb('#24262c'), 0.6)
    G = mat('g', glow, 0.3, emit=glow, emit_str=2)
    if kind == 'buggy':
        cube((0, 0, 0.1), (0.2, 0.34, 0.07), P)
        cube((0, -0.03, 0.15), (0.16, 0.14, 0.06), A)
        wheels((-0.13, 0.13), (-0.12, 0.13), 0.06, D)
        for x in (-0.07, 0.07):
            cyl((x, 0.04, 0.22), 0.008, 0.14, D, verts=6)
        cube((0, 0.04, 0.29), (0.15, 0.012, 0.012), D)
    elif kind == 'hovertank':
        o = cube((0, 0, 0.12), (0.3, 0.44, 0.1), P)
        cube((0, -0.02, 0.2), (0.24, 0.3, 0.05), A)
        cyl((0, 0.02, 0.26), 0.09, 0.07, P, verts=12)
        cube((0, -0.16, 0.27), (0.03, 0.28, 0.03), D)
        cube((0, 0, 0.065), (0.26, 0.4, 0.02), G)
    elif kind == 'mortar':
        cyl((0, 0, 0.02), 0.12, 0.03, D, verts=12)
        cyl((0, -0.02, 0.15), 0.035, 0.28, P, verts=12, rot=(0.6, 0, 0))
        cube((0.0, 0.08, 0.06), (0.1, 0.06, 0.08), A)
        figure(prim, acc, glow, x=0.14, y=0.06, s=0.7, helmet='round', weapon=None)
    elif kind == 'railgun':
        cube((0, 0.02, 0.07), (0.26, 0.34, 0.08), D)
        cube((0, 0.02, 0.14), (0.2, 0.26, 0.06), P)
        for x in (-0.035, 0.035):
            cube((x, -0.16, 0.2), (0.025, 0.42, 0.03), A, rot=(0.12, 0, 0))
        cube((0, -0.36, 0.23), (0.09, 0.02, 0.01), G)
    elif kind == 'shuttle':
        o = sphere((0, 0, 0.3), 0.1, P, scale=(0.9, 2.2, 0.8))
        cube((0, 0.05, 0.3), (0.5, 0.12, 0.015), P)
        for x in (-0.24, 0.24):
            cyl((x, 0.05, 0.3), 0.04, 0.12, A, verts=12, rot=(1.5708, 0, 0))
            sphere((x, 0.12, 0.3), 0.03, G)
        sphere((0, -0.13, 0.33), 0.05, mat('gl', srgb('#9fd3ff'), 0.1, metal=0.5), scale=(0.8, 1.2, 0.6))
        cube((0, 0.2, 0.36), (0.015, 0.08, 0.08), A)
    elif kind == 'shieldgen':
        cube((0, 0, 0.06), (0.22, 0.3, 0.08), D)
        wheels((-0.12, 0.12), (-0.1, 0.1), 0.045, D)
        cyl((0, 0, 0.22), 0.025, 0.24, P, verts=10)
        sphere((0, 0, 0.36), 0.06, G)
        dome = mat('dome', glow, 0.05, emit=glow, emit_str=0.3, transmission=0.95)
        sphere((0, 0, 0.0), 0.3, dome, scale=(1, 1, 0.85))
    elif kind == 'settler':
        cube((0, 0.05, 0.13), (0.2, 0.34, 0.14), P)
        cube((0, -0.16, 0.11), (0.19, 0.12, 0.1), A)
        cube((0, -0.2, 0.15), (0.16, 0.02, 0.04), mat('gl', srgb('#9fd3ff'), 0.1))
        wheels((-0.12, 0.12), (-0.14, 0.14), 0.05, D)
        cube((0, 0.06, 0.22), (0.16, 0.26, 0.02), mat('sol', srgb('#22304a'), 0.2, metal=0.6))
    elif kind == 'worker':
        cube((0, 0, 0.09), (0.18, 0.24, 0.08), A)
        wheels((-0.11, 0.11), (-0.08, 0.08), 0.045, D)
        cyl((0.03, 0.03, 0.2), 0.015, 0.2, P, verts=8, rot=(0.6, 0.0, 0))
        cube((0.03, -0.07, 0.3), (0.03, 0.12, 0.03), P, rot=(0.3, 0, 0))
        figure(prim, acc, glow, x=-0.05, y=0.07, s=0.6, helmet='round', weapon=None, cap=True)


def creature(kind):
    if kind == 'crawler':
        m = noise_mat('ch', srgb('#5a3b2a'), srgb('#9a6a3a'), scale=12, rough=0.4)
        for i in range(3):
            sphere((0, 0.08 - i * 0.09, 0.08), 0.08 - i * 0.012, m, scale=(1.2, 1, 0.7))
        for side in (-1, 1):
            for j in range(3):
                cyl((side * 0.12, 0.06 - j * 0.07, 0.05), 0.012, 0.18, m, verts=6, rot=(0, side * 1.2, 0))
            sphere((side * 0.12, -0.12, 0.08), 0.04, m, scale=(1, 1.6, 0.6))
        cyl((0, 0.2, 0.18), 0.02, 0.24, m, verts=8, rot=(-0.6, 0, 0))
        sphere((0, 0.27, 0.3), 0.03, mat('st', srgb('#e04a2a'), 0.3, emit=srgb('#ff5a2a'), emit_str=1.5))
    elif kind == 'stinger':
        m = mat('sb', srgb('#3c4a2a'), 0.35, metal=0.3)
        sphere((0, 0, 0.3), 0.06, m, scale=(1, 2.2, 0.9))
        sphere((0, -0.13, 0.31), 0.05, m)
        wing = mat('wing', srgb('#c8e0f0'), 0.1, transmission=0.8)
        for side in (-1, 1):
            o = sphere((side * 0.14, 0.0, 0.36), 0.12, wing, scale=(1.4, 0.5, 0.05))
        for side in (-1, 1):
            sphere((side * 0.03, -0.17, 0.33), 0.018, mat('eye', srgb('#ff3030'), 0.2, emit=srgb('#ff3030'), emit_str=2))
    elif kind == 'armadillo':
        m = noise_mat('ar', srgb('#4a4a3a'), srgb('#7a7458'), scale=8, rough=0.6)
        sphere((0, 0, 0.14), 0.18, m, scale=(1, 1.3, 0.8))
        for i in range(4):
            cyl((0, 0.15 - i * 0.1, 0.16), 0.2, 0.03, m, verts=16, rot=(1.5708, 0, 0))
        sphere((0, -0.26, 0.12), 0.08, m)
        cone((0, -0.33, 0.17), 0.03, 0.1, mat('hr', srgb('#d8d0b0'), 0.5), rot=(-1.2, 0, 0))
        for (x, y) in [(-0.12, 0.12), (0.12, 0.12), (-0.12, -0.12), (0.12, -0.12)]:
            cyl((x, y, 0.04), 0.035, 0.08, m, verts=8)
    elif kind == 'colossus':
        m = noise_mat('co', srgb('#3a4a3a'), srgb('#6a7a52'), scale=6, rough=0.55)
        for x in (-0.08, 0.08):
            cyl((x, 0.02, 0.12), 0.05, 0.24, m, verts=10)
        sphere((0, 0.02, 0.34), 0.15, m, scale=(1, 1.2, 1.1))
        sphere((0, -0.14, 0.5), 0.09, m, scale=(1, 1.4, 0.9))
        cyl((0, 0.2, 0.26), 0.05, 0.3, m, verts=10, rot=(-1.1, 0, 0), r2=0.01)
        for side in (-1, 1):
            sphere((side * 0.04, -0.24, 0.53), 0.018, mat('eye', srgb('#ffcc33'), 0.2, emit=srgb('#ffcc33'), emit_str=3))
        for i in range(4):
            cone((0, 0.12 - i * 0.07, 0.47 - i * 0.02), 0.025, 0.08, mat('sp', srgb('#c86a3a'), 0.5))


INFANTRY = {
    'warrior':   dict(helmet='round', weapon='rifle'),
    'archer':    dict(helmet='round', weapon='long'),
    'spearman':  dict(helmet='visor', weapon='rifle', shield=True),
    'swordsman': dict(helmet='visor', weapon='rifle', bulk=1.1),
    'crossbow':  dict(helmet='round', weapon='long', cloak=True),
    'pikeman':   dict(helmet='visor', weapon='rifle', bulk=1.3, shield=True),
    'musketeer': dict(helmet='visor', weapon='cannon', bulk=1.55),
    'volunteers': dict(helmet='round', weapon='rifle', cap=True),
}
VEHICLES = {'horseman': 'buggy', 'knight': 'hovertank', 'catapult': 'mortar', 'cannon': 'railgun',
            'shuttle': 'shuttle', 'shieldgen': 'shieldgen', 'settler': 'settler', 'worker': 'worker'}
FAUNA = ['crawler', 'stinger', 'armadillo', 'colossus']
UNIQUE = {'shuttle': 'empire', 'shieldgen': 'scientists', 'volunteers': 'believers'}


def render_unit(utype, team):
    sc = reset()
    shadow_catcher(2)
    if utype in FAUNA:
        creature(utype)
    else:
        prim, acc, glow = TEAM[team]
        base_disc(acc)
        if utype in INFANTRY:
            spec = INFANTRY[utype]
            count = 2 if utype in ('warrior', 'archer', 'volunteers', 'crossbow') else 1
            if count == 2:
                figure(prim, acc, glow, x=-0.1, y=0.06, s=1.35, **spec)
                figure(prim, acc, glow, x=0.1, y=-0.06, s=1.35, **spec)
            else:
                figure(prim, acc, glow, s=1.6, **spec)
        else:
            vehicle(VEHICLES[utype], prim, acc, glow)
    fr = camera(sc, 0.9, -0.45 * K, 0.85)
    render(sc, f'unit_{utype}_{team}', fr, 'unit')

# ---------------- запуск ----------------

def want(name):
    return not ONLY or name.startswith(ONLY)


jobs = []
for t in ['grass', 'plains', 'desert', 'tundra', 'forest', 'hills', 'mountain', 'water', 'shallow']:
    for v in range(3):
        jobs.append((f'ground_{t}_{v}', lambda t=t, v=v: render_ground(t, v)))
for t in ['forest', 'hills', 'mountain']:
    for v in range(3):
        jobs.append((f'prop_{t}_{v}', lambda t=t, v=v: render_prop(t, v)))
for t in ['ruins', 'ruins_done', 'nest']:
    jobs.append((f'prop_{t}_0', lambda t=t: render_prop(t, 0)))
for n in ['res_crystals', 'res_geyser', 'res_fertile', 'res_metals', 'res_plankton', 'imp_farm', 'imp_mine', 'imp_lumber']:
    jobs.append((n, lambda n=n: render_small(n)))
for st in ['empire', 'scientists', 'believers', 'colonists', 'minor']:
    for lv in (1, 2, 3):
        jobs.append((f'city_{st}_{lv}', lambda st=st, lv=lv: render_city(st, lv)))
    if st != 'minor':
        jobs.append((f'capital_{st}', lambda st=st: render_landmark(st)))
    jobs.append((f'walls_{st}', lambda st=st: render_walls(st)))
for u in list(INFANTRY) + list(VEHICLES):
    for team in TEAM:
        if u in UNIQUE and UNIQUE[u] != team:
            continue
        if team == 'minor' and u in ('settler', 'worker', 'shuttle', 'shieldgen'):
            continue
        jobs.append((f'unit_{u}_{team}', lambda u=u, team=team: render_unit(u, team)))
for f in FAUNA:
    jobs.append((f'unit_{f}_fauna', lambda f=f: render_unit(f, 'fauna')))

for name, fn in jobs:
    done = name in MANIFEST and os.path.exists(os.path.join(OUT, name + '.png'))
    if want(name) and (ONLY or not done):
        random.seed(name)
        fn()
        json.dump({'tilt': math.degrees(TILT), 'k': K, 'sprites': MANIFEST}, open(man_path, 'w'), indent=0)
print('DONE', len(MANIFEST))
