import * as migration_20260829_193521_init from './20260829_193521_init';
import * as migration_20260830_150000_trips from './20260830_150000_trips';
import * as migration_20260830_210000_write_token from './20260830_210000_write_token';

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
  {
    up: migration_20260830_210000_write_token.up,
    down: migration_20260830_210000_write_token.down,
    name: '20260830_210000_write_token'
  },
];
