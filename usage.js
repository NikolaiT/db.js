const DBjs = require('./dbjs').DBjs;

const config = {
    // after what size in MB the memory cache should be persisted to disk
    persist_after_MB: 20,
    // after what time in seconds the memory cache should be persisted to disk
    persist_after_seconds: 12 * 60 * 60,
    // absolute/relative path to database directory
    database_path: '/tmp/database/',
    // path to file where to log debug outputs to
    logfile_path: '/tmp/dbjs.log',
    // after how many seconds should the cache and index be persisted
    flush_interval: 5 * 60,
    // file prefix for archived files
    file_prefix: 'dbjs_',
    // whether to print debug output
    debug: false,
    // max key size in bytes
    max_key_size_bytes: 1024,
    // max value size in bytes
    max_value_size_bytes: 1048576,
};

let db_js = new DBjs(config);

db_js.set('someKey', 'someValue');
console.log(db_js.get('someKey'));
db_js.close();