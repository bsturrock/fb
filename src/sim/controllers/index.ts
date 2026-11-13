import type { Controller } from './base';
import { ScriptController } from './base';
import { CoachedEntryController } from './coached';
import { WrapAttemptController, type WrapProfile } from './wrap';
import type { ControllerSpec, PlayerSetup } from '../fixture';
import type { MotorProfile } from '../profiles';
import { dirFromHeading, rad } from '../vec';

export function makeController(spec: ControllerSpec, setup: PlayerSetup, motor: MotorProfile, wrap?: WrapProfile): Controller {
  switch (spec.kind) {
    case 'script':
      return new ScriptController(spec, dirFromHeading(rad(setup.initial.yawDeg)));
    case 'coachedEntry':
      return new CoachedEntryController(spec, motor, setup.body.massKg);
    case 'wrapAttempt':
      return new WrapAttemptController(spec, setup, motor, wrap);
  }
}
