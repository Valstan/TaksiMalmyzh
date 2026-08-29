import * as migration_20260829_193521_init from './20260829_193521_init';

export const migrations = [
  {
    up: migration_20260829_193521_init.up,
    down: migration_20260829_193521_init.down,
    name: '20260829_193521_init'
  },
];
