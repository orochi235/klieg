import * as THREE from 'three';
import type { FireHandle, Klieg, KliegOptions } from './api.js';
import { type Clock, RafClock } from './clock.js';
import { EFFECTS } from './effects/patches.js';
import type { EffectName } from './effects/types.js';
import { type FireControl, type Instance, runFire } from './fire.js';
import { SceneLayers } from './layers.js';
import { ACTIVE } from './motion/active.js';
import { ENTER } from './motion/enter.js';
import { EXIT } from './motion/exit.js';
import { assertHold } from './motion/sequence.js';
import type { ActiveName, EnterName, ExitName } from './motion/types.js';
import { PointerWatch } from './pointer.js';
import { EffectQueue, type QueuePolicy } from './queue.js';
import { wantsBloom } from './render/bloom.js';
import { WordCaches } from './render/caches.js';
import { ENV_PATCHES, type LightingName } from './render/lighting.js';
import { LOOKS, type Look, type LookName, type LookSpec } from './render/looks.js';
import { Stage as SceneStage, webglSupported } from './render/stage.js';
import { scheduleWarm } from './render/warm.js';
import type { Word } from './render/word.js';
import { DEFAULT_LOOK } from './resolve.js';
import { registryFor } from './text/font-registry.js';
import type { Transform } from './transform.js';

/** blits' own signal combinators, which klieg's signals are built from and compose with. */
export { gate, lag, peak, slew } from '@msb235/blits';
export {
  type AcronymOptions,
  acronym,
  isCapital,
  type LetterStyle,
} from './acronym.js';
export type {
  ActiveSlot,
  Align,
  BackdropSpec,
  CameraSpec,
  EnterSlot,
  ExitSlot,
  FireHandle,
  FireOptions,
  Framing,
  Klieg,
  KliegOptions,
  LightingSlot,
  Placement,
  SceneLayer,
  Stage,
  TextRun,
  TweenSpec,
  TypePoint,
} from './api.js';
export { MAX_BACKDROP_ROWS } from './backdrop.js';
export { ManualClock } from './clock.js';
export {
  backOut,
  type Easing,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  linear,
  type SpringParams,
  spring,
} from './easing.js';
export { hinge, type StopsSpec } from './effects/hinge.js';
export { type IntermittentSpec, intermittent } from './effects/intermittent.js';
export { type Kicks, type KicksSpec, kicks } from './effects/kick.js';
export { type LampSpec, lamp } from './effects/lamp.js';
export { type ChaseSpec, EFFECTS, type FlickerSpec, type HueSpec } from './effects/patches.js';
export {
  type BlowoutSpec,
  blowout,
  type Flare,
  type GlowSpec,
  glow,
  type PowerControl,
  type PowerSpec,
  type PowerState,
  power,
  type StrikeSpec,
  strike,
  type ThinningSpec,
  type TripSpec,
  thinning,
  type Warmup,
} from './effects/power.js';
export { type RovingSpec, roving } from './effects/roving.js';
export {
  type DwellSpec,
  dwell,
  type Level,
  level,
  type NearSpec,
  near,
  type Signal,
} from './effects/signal.js';
export {
  along,
  fixed,
  fromPointer,
  type LightPose,
  type LightSource,
  type OrbitSpec,
  orbit,
} from './effects/source.js';
export { type TurnsSpec, turns } from './effects/turns.js';
export type {
  EffectName,
  EffectPatch,
  EffectSpec,
  Hinged,
  Host,
  LightDelta,
  PartDelta,
  PartInfo,
  PartKind,
  Setting,
} from './effects/types.js';
export { effect } from './effects/types.js';
export {
  type CycleSpec,
  cycle,
  type Keyframe,
  type TransitionSpec,
  transition,
} from './motion/build.js';
export type { MarkEvent, MarkListener } from './motion/marks.js';
export type { Layered, LetterInfo, MotionPatch, StaggerFrom, StaggerSpec } from './motion/types.js';
export { motion, stagger } from './motion/types.js';
export type { Pose, PoseDelta, Vec3 } from './pose.js';
export { POLICY_NAMES } from './queue.js';
export { wantsBloom } from './render/bloom.js';
export type { DecorationSpec, MaterialSpec } from './render/decoration.js';
export type { FlakeSpec } from './render/flake.js';
export {
  ENV_PATCHES,
  type EnvDelta,
  type EnvPatch,
  type EnvPose,
  lighting,
  mergeEnv,
  type SweepSpec,
  still,
  sweep,
  type TrackSpec,
  track,
} from './render/lighting.js';
export type { LookParams, TintTarget } from './render/looks.js';
/** The spec behind a built-in name, for building a variation on one. */
export { specOf } from './render/looks.js';
export type {
  ContourPolicies,
  ContourPolicy,
  ContourRole,
  CornerStrategy,
  CornerWeights,
  PathSource,
  RescueRung,
  Run,
  SelectSpec,
  ShortRun,
  SurfaceKind,
  TubeSpec,
} from './render/tube/index.js';
export { ALL_BREAK, ALL_CONNECT, RESCUE_LADDER } from './render/tube/index.js';
export type { SelectableMode } from './text/dom-layer.js';
export type { Arrangement } from './text/placement.js';
export { compose, fromAxisAngle, fromEuler, type Transform } from './transform.js';
export type {
  ActiveName,
  Clock,
  EnterName,
  ExitName,
  LightingName,
  Look,
  LookName,
  LookSpec,
  QueuePolicy,
};

// Read off the records the effect itself indexes. Those are typed exhaustive over the unions,
// so a name cannot be added, renamed or dropped without these lists following it.
export const ENTER_NAMES: readonly EnterName[] = Object.keys(ENTER) as EnterName[];
export const ACTIVE_NAMES: readonly ActiveName[] = Object.keys(ACTIVE) as ActiveName[];
export const EXIT_NAMES: readonly ExitName[] = Object.keys(EXIT) as ExitName[];
export const LOOK_NAMES: readonly LookName[] = Object.keys(LOOKS) as LookName[];
export const LIGHTING_NAMES: readonly LightingName[] = Object.keys(ENV_PATCHES) as LightingName[];
export const EFFECT_NAMES: readonly EffectName[] = Object.keys(EFFECTS) as EffectName[];

/** Whether a mesh is on screen: every ancestor visible and some opacity left. A letter mid-exit
 * keeps its geometry at zero opacity. */
function drawn(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  const material = (object as THREE.Mesh).material;
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  return materials.some((m) => m.visible && m.opacity > 0);
}

export function createKlieg(options: KliegOptions): Klieg {
  const placement = options.placement ?? { kind: 'fullscreen' };
  const anchored = placement.kind === 'element';
  const clickAnywhere = placement.kind === 'element' && placement.clickAnywhere === true;
  if (anchored && options.target) {
    throw new Error('klieg: an element placement is its own parent, so `target` cannot apply');
  }

  const supported = webglSupported();
  const clock = options.clock ?? new RafClock();
  const queue = new EffectQueue(options.policy ?? 'queue');
  const stage = new SceneStage({
    target: options.target,
    idleTimeoutMs: options.idleTimeoutMs ?? 8000,
    placement,
    ...(options.framing ? { framing: options.framing } : {}),
    ...(options.bleed === undefined ? {} : { bleed: options.bleed }),
    ...(options.camera ? { camera: options.camera } : {}),
  });

  const caches = new WordCaches();
  const fonts = registryFor(options);
  let destroyed = false;
  let fired = false;
  const pointer = new PointerWatch();
  const inst: Instance = {
    stage,
    clock,
    caches,
    framing: options.framing,
    heroes: new Set<Word>(),
    liveFires: 0,
    font: (name) => fonts.load(name),
    pointer,
    layers: new SceneLayers(
      stage,
      clock,
      () => inst.liveFires === 0,
      () => destroyed,
    ),
  };
  const { heroes, layers } = inst;
  const warmLook = options.warmLook ?? DEFAULT_LOOK;
  const warmer = supported
    ? scheduleWarm({
        stage,
        font: () => inst.font(),
        look: warmLook,
        blooms: wantsBloom(undefined, warmLook),
        caches,
        stale: () => destroyed || fired,
        gone: () => destroyed,
        busy: () => inst.liveFires > 0 || layers.live(),
      })
    : null;
  const raycaster = new THREE.Raycaster();
  const aim = new THREE.Vector2();

  let counter = 0;

  return {
    supported,
    fire(text, opts = {}) {
      fired = true;
      // Frees the warm's held throwaway: its programs have done their job the moment a real word
      // is about to be built, and its blueprint lease would otherwise make this fire take a copy.
      warmer?.release();
      const control: FireControl = { dismiss: null, latched: false, transform: null, turn: null };
      const handle = (promise: Promise<void>): FireHandle =>
        Object.assign(promise, {
          advance(): void {
            if (control.dismiss) control.dismiss();
            else control.latched = true;
          },
          turn(transform: Transform): void {
            control.transform = transform;
            control.turn?.(transform);
          },
        });

      // The dismissal is a press anywhere in the window, which on a strip sharing a page ends the
      // effect on clicks that have nothing to do with it. An anchor filling the viewport has no
      // such clicks, so it may opt in; one that has not stays out rather than stall on a listener
      // it never wanted. `dismiss: 'host'` attaches no listener, so there is nothing to gate.
      if (
        anchored &&
        !clickAnywhere &&
        opts.dismiss !== 'host' &&
        (opts.hold === 'click' || opts.stages?.some((s) => s.hold === 'click'))
      ) {
        throw new Error(
          "klieg: an element placement takes `hold: 'click'` only with `clickAnywhere` set on it",
        );
      }
      if (opts.hold === 'forever' && opts.stages?.length) {
        throw new Error(
          "klieg: `hold: 'forever'` never advances a stage, so `stages` cannot apply",
        );
      }
      // Before the supported check: a typo is a typo on a machine with no WebGL too, and
      // swallowing it there would make the bug reproduce only on some laptops. The registry
      // raises it, so the message has one author.
      if (opts.font !== undefined) fonts.assertKnown(opts.font);
      if (opts.startAt) assertHold(opts.startAt.hold, opts.stages?.length ?? 0);
      if (!supported || destroyed) return handle(Promise.resolve());
      return handle(
        queue.push(
          `${counter++}:${text}`,
          (signal) => runFire(inst, text, opts, signal, control),
          opts.signal,
        ),
      );
    },
    warm(look) {
      if (!supported || destroyed || !warmer) return Promise.resolve();
      const chosen = look ?? warmLook;
      return warmer.run(chosen, wantsBloom(undefined, chosen));
    },
    preheat(chars, name) {
      // Before the await, so a name the instance does not hold throws where it was written rather
      // than arriving as a rejection later.
      if (name !== undefined) fonts.assertKnown(name);
      if (destroyed) return Promise.resolve();
      return fonts.load(name).then((loaded) => {
        // `destroy` can land while the face is in flight, and the caches are disposed by then.
        if (!destroyed) caches.preheat(loaded, chars);
      });
    },
    attach(layer) {
      if (!supported || destroyed) return () => {};
      return layers.attach(layer);
    },
    pointOn(clientX, clientY) {
      const canvas = stage.canvas;
      if (destroyed || !canvas || heroes.size === 0) return null;
      const box = canvas.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      const nx = ((clientX - box.left) / box.width) * 2 - 1;
      const ny = ((clientY - box.top) / box.height) * 2 - 1;
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;

      stage.camera.updateMatrixWorld();
      raycaster.setFromCamera(aim.set(nx, -ny), stage.camera);
      const groups = [...heroes].map((word) => {
        word.group.updateWorldMatrix(true, true);
        return word.group;
      });
      const hit = raycaster.intersectObjects(groups, true).find((h) => drawn(h.object));
      if (!hit) return null;
      let owner: Word | undefined;
      hit.object.traverseAncestors((o) => {
        owner ??= [...heroes].find((word) => word.group === o);
      });
      const { x, y, z } = hit.point;
      return {
        x,
        y,
        z,
        unitsPerPx: stage.unitsPerPixel(z, box.height),
        inWord: owner ? owner.layoutOf(hit.point) : { x: 0, y: 0 },
      };
    },
    destroy() {
      destroyed = true;
      warmer?.cancel();
      pointer.release();
      layers.detachAll();
      // A running effect only notices the abort on its next tick, and tearing down first would
      // leave it re-arming idle teardown against a stage that is already gone.
      void queue.cancelAll().then(() => {
        stage.unmount();
        caches.dispose();
      });
    },
  };
}
