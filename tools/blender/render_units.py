# Рендер анимированных юнитов: персонажи и анимации Quaternius (CC0), одетые в броню фракций.
# blender -b -P tools/blender/render_units.py -- <папка_моделей> <папка_вывода> [фильтр]
# Папка моделей: распакованные Universal Base Characters и Universal Animation Library.
import bpy, math, sys, os, json, glob
from mathutils import Vector, Euler, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
ONLY = ARGS[2] if len(ARGS) > 2 else ''
TILT = math.radians(40)
K = math.cos(TILT)
PX = 192          # как у остальной графики: пикселей на радиус гекса
FIG = 1.1        # рост фигурки в радиусах гекса
os.makedirs(OUT, exist_ok=True)
man_path = os.path.join(OUT, 'units.json')
MAN = json.load(open(man_path)) if os.path.exists(man_path) else {}

CHAR = glob.glob(os.path.join(SRC, 'ubc', '**', 'Godot - UE', 'Superhero_Male_FullBody.gltf'), recursive=True)[0]
ANIMS = glob.glob(os.path.join(SRC, 'ual', '**', 'UAL1_Standard.glb'), recursive=True)[0]

# Какие анимации и сколько кадров берём
CLIPS = {
    'idle':  ('Pistol_Idle_Loop', 1),
    'walk':  ('Walk_Loop', 8),
    'shoot': ('Pistol_Shoot', 5),
    'hit':   ('Hit_Chest', 3),
    'death': ('Death01', 6),
}
MELEE_CLIPS = dict(CLIPS, idle=('Sword_Idle', 1), shoot=('Sword_Attack', 6))


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, color, rough=0.5, metal=0.0, emit=None, emit_str=0.0, transmission=0.0):
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
    return m


TEAMS = {
    'empire':     dict(suit='#2a3142', armor='#f4f6fa', trim='#d4af37', visor='#3b82f6', cloth='#c9d2e3'),
    'scientists': dict(suit='#33504d', armor='#e3ecea', trim='#1fb3a5', visor='#5ff2e2', cloth='#9fb9b6'),
    'believers':  dict(suit='#4a4650', armor='#8a8490', trim='#9c1f42', visor='#f0dcb4', cloth='#7a1530'),
    'colonists':  dict(suit='#4a4234', armor='#c9b58b', trim='#e08a20', visor='#9fd3ff', cloth='#6b5a3a'),
    'minor':      dict(suit='#3e4634', armor='#8a9470', trim='#c7b37a', visor='#d8e0a0', cloth='#4a5440'),
}

# Снаряжение по типам юнитов
GEAR = {
    'warrior':    dict(weapon='rifle', helmet='light'),
    'archer':     dict(weapon='long', helmet='light'),
    'spearman':   dict(weapon='rifle', helmet='full', shield=True),
    'swordsman':  dict(weapon='rifle', helmet='full', pads=True),
    'crossbow':   dict(weapon='long', helmet='hood', cape=True),
    'pikeman':    dict(weapon='rifle', helmet='full', pads=True, shield=True, bulk=1.08),
    'musketeer':  dict(weapon='heavy', helmet='exo', pads=True, bulk=1.18, exo=True),
    'volunteers': dict(weapon='rifle', helmet='cap', cape=True),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.62, 0.70, 0.82, 1)
    bg.inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.4
    sun.data.angle = math.radians(6)
    sun.rotation_euler = Euler((math.radians(34), math.radians(-14), math.radians(-35)))
    sc.collection.objects.link(sun)
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'SUN'))
    rim.data.energy = 1.2
    rim.rotation_euler = Euler((math.radians(-60), 0, math.radians(160)))
    sc.collection.objects.link(rim)
    return sc


def camera(sc, w, y0, y1):
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    h = y1 - y0
    cam.data.ortho_scale = max(w, h)
    sc.render.resolution_x = int(round(w * PX))
    sc.render.resolution_y = int(round(h * PX))
    cam.rotation_euler = Euler((TILT, 0, 0))
    d = Vector((0, math.sin(TILT), -math.cos(TILT)))
    up = Vector((0, math.cos(TILT), math.sin(TILT)))
    cam.location = up * ((y0 + y1) / 2) - d * 20
    cam.data.clip_end = 100
    sc.collection.objects.link(cam)
    sc.camera = cam
    return {'w': sc.render.resolution_x, 'h': sc.render.resolution_y, 'ax': w / 2 * PX, 'ay': y1 * PX}


def attach(obj, arm, bone):
    """Прикрепить объект к кости, сохранив его текущее положение."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    arm.data.bones.active = arm.data.bones[bone]
    bpy.ops.object.parent_set(type='BONE', keep_transform=True)


def prim(kind, loc, size, m, rot=(0, 0, 0), verts=16):
    if kind == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = size
        bev = o.modifiers.new('bev', 'BEVEL')
        bev.width = min(size) * 0.18
        bev.segments = 2
    elif kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = size
        for p in o.data.polygons:
            p.use_smooth = True
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=1, depth=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = size
        for p in o.data.polygons:
            p.use_smooth = True
    o.data.materials.append(m)
    return o


def bone_head(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].head


def bone_tail(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].tail


def build_soldier(utype, team):
    t = TEAMS[team]
    gear = GEAR.get(utype, GEAR['warrior'])
    bpy.ops.import_scene.gltf(filepath=CHAR)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = [o for o in bpy.data.objects if o.type == 'MESH']
    suit = mat('suit', srgb(t['suit']), 0.55)
    armor = mat('armor', srgb(t['armor']), 0.35, metal=0.15)
    trim = mat('trim', srgb(t['trim']), 0.35, metal=0.6)
    visor = mat('visor', srgb(t['visor']), 0.15, emit=srgb(t['visor']), emit_str=1.6)
    cloth = mat('cloth', srgb(t['cloth']), 0.8)
    dark = mat('dark', srgb('#22252b'), 0.45, metal=0.5)
    for o in body:
        o.data.materials.clear()
        o.data.materials.append(suit)
    # Масштаб: фигурка ростом FIG
    bpy.context.view_layer.update()
    def world_h():
        zs = [(o.matrix_world @ Vector(c)).z for o in body for c in o.bound_box]
        return max(zs) - min(zs)
    k = FIG * gear.get('bulk', 1.0) / world_h()
    for o in bpy.data.objects:
        if o.parent is None:
            o.scale = tuple(v * k for v in o.scale)
            o.location = o.location * k
    bpy.context.view_layer.update()
    print('ROOTS', [(o.name, o.type) for o in bpy.data.objects if o.parent is None])
    print('HEIGHT', round(world_h(), 3))
    head = bone_head(arm, 'Head')
    hs = FIG * 0.075 * gear.get('bulk', 1.0)
    parts = []
    # Шлем
    hk = gear['helmet']
    hc = head + Vector((0, 0, hs * 0.55))
    if hk == 'hood':
        parts.append((prim('sphere', hc, (hs * 0.75, hs * 0.8, hs * 0.85), cloth), 'Head'))
    elif hk == 'cap':
        parts.append((prim('cyl', hc + Vector((0, 0, hs * 0.25)), (hs * 0.62, hs * 0.62, hs * 0.22), cloth), 'Head'))
    else:
        big = 1.15 if hk in ('full', 'exo') else 1.0
        parts.append((prim('sphere', hc, (hs * 0.7 * big, hs * 0.75 * big, hs * 0.72 * big), armor), 'Head'))
        parts.append((prim('cube', hc + Vector((0, -hs * 0.55 * big, -hs * 0.05)), (hs * 0.9, hs * 0.2, hs * 0.32), visor), 'Head'))
        if hk == 'full' or hk == 'exo':
            parts.append((prim('cube', hc + Vector((0, 0, hs * 0.72)), (hs * 0.18, hs * 1.1, hs * 0.18), trim), 'Head'))
    # Бронежилет и рюкзак
    chest = bone_head(arm, 'spine_03')
    cw = hs * (2.3 if gear.get('exo') else 1.9)
    parts.append((prim('cube', chest + Vector((0, -hs * 0.35, 0)), (cw, hs * 0.9, hs * 1.4), armor), 'spine_03'))
    parts.append((prim('cube', chest + Vector((0, -hs * 0.82, hs * 0.1)), (cw * 0.5, hs * 0.08, hs * 0.5), trim), 'spine_03'))
    parts.append((prim('cube', chest + Vector((0, hs * 0.75, -hs * 0.1)), (cw * 0.7, hs * 0.6, hs * 1.1), dark), 'spine_03'))
    if gear.get('pads'):
        for side in ('l', 'r'):
            p = bone_head(arm, f'upperarm_{side}')
            parts.append((prim('sphere', p + Vector((0, 0, hs * 0.1)), (hs * 0.6, hs * 0.6, hs * 0.45), armor), f'upperarm_{side}'))
    if gear.get('exo'):
        for side in ('l', 'r'):
            for bn, sz in ((f'lowerarm_{side}', 0.42), (f'calf_{side}', 0.45), (f'thigh_{side}', 0.5)):
                a, b = bone_head(arm, bn), bone_tail(arm, bn)
                mid = (a + b) / 2
                L = (b - a).length
                o = prim('cube', mid, (hs * sz, hs * sz, L * 0.85), armor)
                o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
                parts.append((o, bn))
    if gear.get('cape'):
        p = bone_head(arm, 'spine_02')
        parts.append((prim('cube', p + Vector((0, hs * 0.75, -hs * 0.9)), (cw * 0.9, hs * 0.12, hs * 2.6), cloth), 'spine_02'))
    # Оружие в правой руке
    hand = bone_head(arm, 'hand_r')
    hdir = (bone_tail(arm, 'hand_r') - hand).normalized()
    wk = gear['weapon']
    L = {'rifle': 0.16, 'long': 0.24, 'heavy': 0.2}[wk] * FIG / 0.62
    rot = hdir.to_track_quat('Y', 'Z').to_euler()
    g = prim('cube', hand + hdir * L * 0.3, (hs * (0.55 if wk == 'heavy' else 0.32), L, hs * (0.6 if wk == 'heavy' else 0.4)), dark)
    g.rotation_euler = rot
    parts.append((g, 'hand_r'))
    g2 = prim('cube', hand + hdir * L * 0.55 + Vector((0, 0, hs * 0.2)), (hs * 0.2, L * 0.3, hs * 0.12), trim)
    g2.rotation_euler = rot
    parts.append((g2, 'hand_r'))
    for side in ('l', 'r'):
        if gear.get('pads') or gear.get('exo'):
            continue
        p = bone_head(arm, f'upperarm_{side}')
        parts.append((prim('sphere', p + Vector((0, 0, hs * 0.05)), (hs * 0.45, hs * 0.45, hs * 0.35), armor), f'upperarm_{side}'))
    if gear.get('shield'):
        lh = bone_head(arm, 'lowerarm_l')
        parts.append((prim('cube', lh + Vector((0, -hs * 0.5, 0)), (hs * 0.25, hs * 1.6, hs * 2.2), armor), 'lowerarm_l'))
    for o, bn in parts:
        attach(o, arm, bn)
    return arm


def load_actions():
    before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=ANIMS)
    lib_objs = [o for o in bpy.context.selected_objects]
    for o in lib_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return {a.name: a for a in bpy.data.actions if a not in before}


def base_disc(team):
    t = TEAMS[team]
    rim = mat('rim', srgb('#15181e'), 0.5)
    top = mat('top', srgb(t['trim']), 0.35)
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.27, depth=0.022, location=(0, 0, 0.011))
    bpy.context.active_object.data.materials.append(rim)
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.245, depth=0.006, location=(0, 0, 0.024))
    bpy.context.active_object.data.materials.append(top)


def render_unit(utype, team):
    sc = reset()
    arm = build_soldier(utype, team)
    actions = load_actions()
    base_disc(team)
    # Смотрит на камеру, чуть вбок (три четверти)
    arm.rotation_euler = Euler((0, 0, math.radians(235)))
    fr = camera(sc, 1.0, -0.42 * K, 1.0)
    clips = MELEE_CLIPS if False else CLIPS
    arm.animation_data_create()
    entry = {'frame': fr, 'px': PX, 'anims': {}}
    for key, (aname, n) in clips.items():
        act = actions.get(aname)
        if not act:
            print('NO ACTION', aname)
            continue
        arm.animation_data.action = act
        try:
            if act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except Exception as e:
            print('SLOT', e)
        f0, f1 = act.frame_range
        frames = [round(f0 + (f1 - f0) * i / max(1, n - (0 if key in ('death', 'shoot', 'hit') else 0))) for i in range(n)]
        if key == 'death':
            frames = [round(f0 + (f1 - f0) * i / (n - 1)) for i in range(n)]
        files = []
        for k, f in enumerate(frames):
            sc.frame_set(int(f))
            name = f'u_{utype}_{team}_{key}_{k}'
            sc.render.filepath = os.path.join(OUT, name + '.png')
            bpy.ops.render.render(write_still=True)
            files.append(name)
        entry['anims'][key] = files
    MAN[f'{utype}_{team}'] = entry
    json.dump(MAN, open(man_path, 'w'), indent=0)
    print('RENDERED UNIT', utype, team)


# ---------- фауна: динозавры Quaternius (CC0), перекрашенные в инопланетных тварей ----------
FAUNA = {
    'crawler':   ('Velociraptor', 'Velociraptor', 0.75, ('#7a3b1e', '#d08a3a')),
    'armadillo': ('Triceratops', 'Triceratops', 0.85, ('#3c4a5c', '#8aa0b4')),
    'colossus':  ('Trex', 'TRex', 1.15, ('#3a2a4a', '#9a6ab4')),
}


def recolor_creature(obj, c1, c2):
    m = bpy.data.materials.new('skin')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 9
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*srgb(c1), 1)
    ramp.color_ramp.elements[1].color = (*srgb(c2), 1)
    ramp.color_ramp.elements[0].position = 0.4
    ramp.color_ramp.elements[1].position = 0.65
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.55
    obj.data.materials.clear()
    obj.data.materials.append(m)


def render_fauna(key):
    fname, prefix, size, (c1, c2) = FAUNA[key]
    path = glob.glob(os.path.join(SRC, 'dino', fname + '.blend'))[0]
    bpy.ops.wm.open_mainfile(filepath=path)
    for o in list(bpy.data.objects):
        if o.type not in ('ARMATURE', 'MESH'):
            bpy.data.objects.remove(o, do_unlink=True)
    keep = {o.name for o in bpy.data.objects}
    sc = bpy.context.scene
    # сцена из reset(), но без очистки модели
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.70, 0.82, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.4
    sun.rotation_euler = Euler((math.radians(34), math.radians(-14), math.radians(-35)))
    sc.collection.objects.link(sun)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name in keep]
    for o in body:
        recolor_creature(o, c1, c2)
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ Vector(c)) for o in body for c in o.bound_box]
    ext = max(max(v.x for v in zs) - min(v.x for v in zs), max(v.y for v in zs) - min(v.y for v in zs))
    k = size / ext
    for o in bpy.data.objects:
        if o.parent is None and o.type in ('ARMATURE', 'MESH'):
            o.scale = tuple(v * k for v in o.scale)
            o.location = o.location * k
    arm.rotation_euler = Euler((0, 0, math.radians(55)))
    fr = camera(sc, 1.2, -0.5 * K, 1.0)
    clips = {'idle': (f'{prefix}_Idle', 1), 'walk': (f'{prefix}_Walk', 8), 'shoot': (f'{prefix}_Attack', 6),
             'hit': (f'{prefix}_Idle', 2), 'death': (f'{prefix}_Death', 6)}
    arm.animation_data_create()
    entry = {'frame': fr, 'px': PX, 'anims': {}}
    for clip, (aname, n) in clips.items():
        act = bpy.data.actions.get(aname)
        if not act:
            print('NO ACTION', aname); continue
        arm.animation_data.action = act
        try:
            if act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        f0, f1 = act.frame_range
        frames = [round(f0 + (f1 - f0) * i / max(1, n - 1 if clip == 'death' else n)) for i in range(n)]
        files = []
        for i, f in enumerate(frames):
            sc.frame_set(int(f))
            name = f'u_{key}_fauna_{clip}_{i}'
            sc.render.filepath = os.path.join(OUT, name + '.png')
            bpy.ops.render.render(write_still=True)
            files.append(name)
        entry['anims'][clip] = files
    MAN[f'{key}_fauna'] = entry
    json.dump(MAN, open(man_path, 'w'), indent=0)
    print('RENDERED UNIT', key, 'fauna')


jobs = [(u, t) for u in GEAR for t in TEAMS]
for u, t in jobs:
    name = f'{u}_{t}'
    if ONLY and ONLY not in name:
        continue
    if ONLY == 'fauna':
        continue
    render_unit(u, t)
for key in FAUNA:
    if ONLY and ONLY not in key and ONLY != 'fauna':
        continue
    render_fauna(key)
print('DONE')
