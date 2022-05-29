const DBjs = require('../dbjs').DBjs;
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const {correct_order, assert, randomString} = require('./test_utils');

async function more_tests() {
    await exec('rm -rf ./new_test_db/');

    let config = {
        persist_after_MB: 20,
        persist_after_seconds: 7,
        database_path: './new_test_db/',
        logfile_path: './beta_logfile.log',
        flush_interval: 4,
        file_prefix: 'dbjs_',
        debug: true,
        max_key_size_bytes: 1024,
        max_value_size_bytes: 1048576,
    }
    
    let db_js = new DBjs(config);

    let num_to_insert = 20;
    // add some random values into the cache
    let to_insert = [];
    let keys = [];
    for (let i = 0; i < num_to_insert; i++) {
        let random_key = randomString(7);
        let random_value = randomString(100);
        to_insert.push([random_key, random_value]);
        db_js.set(random_key, random_value);
        keys.push(random_key);
    }

    // test that index size is `num_to_insert`
    assert(db_js.cache_size() === num_to_insert, 'index size must be 0');

    // test that `num_to_insert` memory writes happend
    assert(db_js._memory_cache_write_counter === num_to_insert, '`num_to_insert` memory writes happend');

    // test that 0 memory reads happened
    assert(db_js._memory_cache_read_counter === 0, '0 memory reads happened');

    // test that 0 file reads happened
    assert(db_js._file_cache_read_counter === 0, '0 file reads happened');

    // test that 0 file writes happened
    assert(db_js._file_cache_write_counter === 0, '0 file writes happened');

    // test that cache size equals num_to_insert
    assert(db_js.cache_size() === num_to_insert, 'cache size equals num_to_insert');

    // test that the first inserted key has index `i` 0
    assert(db_js.index[to_insert[0][0]].i === 0, 'first inserted key has index `i` 0');

    // test that the last inserted key has index `i` num_to_insert-1
    assert(db_js.index[to_insert[num_to_insert-1][0]].i === num_to_insert-1, 'last inserted key has index `i` num_to_insert-1');

    setTimeout(function() {
        // at this point dbjs persisted all values to disk and cache is reset

        // test that we can get all values in order
        for (obj of to_insert) {
            let recv = db_js.get(obj[0]);
            let msg = `can get value in order with get(). Expected=${obj[1]}, Received=${recv}`;
            assert(recv === obj[1], `can get value in order with get().`);
        }

        // test that 20 file reads occured
        assert(db_js._file_cache_read_counter === num_to_insert,
             'num_to_insert file reads happened: ' + db_js._file_cache_read_counter);

        // test that 0 memory reads happend
        assert(db_js._memory_cache_read_counter === 0, '0 memory reads happened');

        // close client and reopen
        db_js.close();

        let new_db_js = new DBjs(config);
        // test that with getn() all values are returned in order
        let all = new_db_js.getn([0, 1000]);
        to_insert.reverse();
        for (let i = 0; i < num_to_insert; i++) {
            assert(all[i] === to_insert[i][1], 'can get value in order with getn()');
        }

        // test that with getn() only one file read happend
        assert(new_db_js._file_cache_read_counter === 1, '1 file reads happened with getn(): ' + new_db_js._file_cache_read_counter);

        // test that 0 file writes happened
        assert(new_db_js._file_cache_write_counter === 0, '0 file writes happened');

        // test that 1 memory reads happened
        assert(new_db_js._memory_cache_read_counter === 1, '1 memory reads happened');

        correct_order(new_db_js, keys);

        new_db_js.close();

    }, (config.flush_interval * 2 * 1000) + 250);
}

more_tests()