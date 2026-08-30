import * as migration_20260829_193521_init from './20260829_193521_init';
import * as migration_20260830_150000_trips from './20260830_150000_trips';

export const migrations = [
  {
    up: migration_20260829_193521_init.up,
    down: migration_20260829_193521_init.down,
    name: '20260829_193521_init'
  },
  {
    up: migration_20260830_150000_trips.up,
    down: migration_20260830_150000_trips.down,
    name: '20260830_150000_trips'
  },
];
