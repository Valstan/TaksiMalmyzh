import * as migration_20260829_193521_init from './20260829_193521_init';
import * as migration_20260830_150000_trips from './20260830_150000_trips';
import * as migration_20260830_210000_write_token from './20260830_210000_write_token';
import * as migration_20260830_233000_finish_reason from './20260830_233000_finish_reason';

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
  {
    up: migration_20260830_233000_finish_reason.up,
    down: migration_20260830_233000_finish_reason.down,
    name: '20260830_233000_finish_reason'
  },
];
