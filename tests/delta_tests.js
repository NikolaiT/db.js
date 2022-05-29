const DBjs = require('../dbjs').DBjs;
const {correct_order, assert, randomString, insert_with_delay, sleep} = require('./test_utils');

let config = {
    persist_after_MB: 20,
    persist_after_seconds: 7,
    database_path: './gamma_db/',
    logfile_path: './gamma_logfile.log',
    flush_interval: 4,
    file_prefix: 'dbjs_',
    debug: true,
    max_key_size_bytes: 1024,
    max_value_size_bytes: 1048576,
}

let db_js = new DBjs(config);

db_js.info()

let all_keys = Object.keys(db_js.index)

correct_order(db_js, all_keys, true);