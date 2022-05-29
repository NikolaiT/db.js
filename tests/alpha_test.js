const DBjs = require('../dbjs').DBjs;
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const {correct_order, assert, randomString} = require('./test_utils');

// Testing will alter the contents of the `test_database`
// Therefore the folder contents have to be recreated before each test.
// `cp -p` preserves file creation timestamps
async function prepare() {
    await exec('rm -rf test_database_staging/ && cp -rp test_database/ test_database_staging');
}

(async () => {
    await prepare();

    let config = {
        persist_after_MB: 0.05,
        persist_after_seconds: 7,
        database_path: './test_database_staging/',
        logfile_path: './alpha_logfile.log',
        flush_interval: 4,
        file_prefix: 'dbjs_',
        debug: true,
        max_key_size_bytes: 1024,
        max_value_size_bytes: 1048576,
    }
    
    let db_js = new DBjs(config);
    const initial_cache_size = db_js.cache_size();
    const initial_index_size = db_js.cache_size();

    if (initial_cache_size !== 0) {
        console.error(`[FAIL] initial_cache_size must be zero. (initial_cache_size=${initial_cache_size})`);
    } else {
        console.log(`[OK] initial_cache_size=${initial_cache_size}`)
    }

    // test that setting a key works
    const value = 'gamma';
    db_js.set('test1234', value);
    let obtained = db_js.get('test1234');

    if (value !== obtained) {
        console.error(`[FAIL] get/set does not work. (value=${value}, obtained=${obtained})`);
    } else {
        console.log('[OK] get/set')
    }
    
    // test that setting another key works
    const key2 = 'qqqqq';
    const value2 = 'delta';
    db_js.set(key2, value2);
    let obtained2 = db_js.get(key2);
    
    if (value2 !== obtained2) {
        console.error(`[FAIL] get/set does not work. (value=${value2}, obtained=${obtained2})`);
    } else {
        console.log('[OK] get/set')
    }
    
    // test getting everything works
    let all = db_js.getn([0, 100000], null);
    let index_size = db_js.index_size();
    let all_res_length = all.length;

    if (index_size !== all_res_length) {
        console.error(`[FAIL] all results size differs from index size. (index size=${index_size}, all_res_length=${all_res_length})`);
    } else {
        console.log('[OK] getn() [0, 100000] getting all results')
    }

    // test cache is empty since we haven't added a new value
    if (db_js.cache_size() !== 0) {
        console.error(`[FAIL] db_js.cache_size() should be empty: ${db_js.cache_size()}`);
    } else {
        console.log('[OK] db_js.cache_size() is 0')
    }
    
    let num_to_insert = 10;
    // add some random values into the cache
    let to_insert = [];
    let keys = [];
    for (let i = 0; i < num_to_insert; i++) {
        let random_key = 'key_' + (Math.floor(Math.random() * 10000000)).toString();
        keys.push(random_key);
        let random_value = randomString(7);
        to_insert.push([random_key, random_value]);
        db_js.set(random_key, random_value);
    }

    // test cache has excactly `num_to_insert` values
    if (db_js.cache_size() !== num_to_insert) {
        console.error(`[FAIL] db_js.cache_size() should have ${num_to_insert} values`);
    } else {
        console.log(`[OK] db_js.cache_size() should have ${num_to_insert} values`);
    }

    // test that the index size is also increased by `num_to_insert`
    if (db_js.cache_size() !== (initial_index_size + num_to_insert)) {
        console.error(`[FAIL] db_js.index_size() should have grown by ${num_to_insert} values`);
    } else {
        console.log(`[OK] db_js.index_size() should have grown to ${(initial_index_size + num_to_insert)}`);
    }

    // test that we can obtain exactly those values that we have inserted before
    for (let obj of to_insert) {
        let retval = db_js.get(obj[0]);
        if (retval !== obj[1]) {
            console.error(`[FAIL] db_js.get() should have returned ${obj} but returned ${retval}`);
        } else {
            console.log(`[OK] db_js.get() works as intended`);
        }
    }

    // Test the same, but reverse order
    for (let obj of to_insert.reverse()) {
        let retval = db_js.get(obj[0]);
        if (retval !== obj[1]) {
            console.error(`[FAIL] reverse db_js.get() should have returned ${obj} but returned ${retval}`);
        } else {
            console.log(`[OK] reverse db_js.get() works as intended`);
        }
    }

    // test getting everything based on time works
    let all2 = db_js.getn(null, [1549418657952, 1749418657952]);
    let index_size2 = db_js.index_size();
    let all_res_length2 = all2.length;

    if (index_size2 !== all_res_length2) {
        console.error(`[FAIL] db_js.getn(null, [1549418657952, 1749418657952]) all results size differs from index size. (index size=${index_size2}, all_res_length=${all_res_length2})`);
    } else {
        console.log('[OK] db_js.getn(null, [1549418657952, 1749418657952]) getting all results based on time. num res = ' + all_res_length2);
    }

    // test that getn() without params returns cache memory size objects
    let all3 = db_js.getn();
    assert(all3.length === db_js.cache_size(), 'getn() returns cache size values. ' + all3.length);

    // test setting a key twice will increase index size by only once 
    // and will update the key
    let first_val = randomString(7);
    let second_val = randomString(7);
    let cache_size = db_js.cache_size();
    db_js.set('4358439jeadslfjs', first_val);
    let cache_size2 = db_js.cache_size();
    db_js.set('4358439jeadslfjs', second_val);
    let cache_size3 = db_js.cache_size();

    // test the cache size is one larger than `num_to_insert`
    if (db_js.cache_size() !== num_to_insert + 1) {
        console.error(`[FAIL] new db_js.cache_size() should have ${num_to_insert + 1} values`);
    } else {
        console.log(`[OK] new db_js.cache_size() should have ${num_to_insert + 1} values`);
    }

    // test that the index size is also increased by one
    if (db_js.cache_size() !== (initial_index_size + num_to_insert + 1)) {
        console.error(`[FAIL] db_js.index_size() should have grown by 1`);
    } else {
        console.log(`[OK] db_js.index_size() should have grown to ${(initial_index_size + num_to_insert + 1)}`);
    }

    let db_val = db_js.get('4358439jeadslfjs');

    // setting a key twice will increment cache only by one
    if (! (((cache_size + 1) === cache_size2) &&  (cache_size2 === cache_size3))) {
        console.error(`[FAIL] cache size should be incremented only by one when setting a key twice: ${cache_size} ${cache_size2} ${cache_size3}`);
    } else {
        console.log(`[OK] cache size should be incremented only by one when setting a key twice: ${cache_size} ${cache_size2} ${cache_size3}`);
    }

    if (! ((first_val !== second_val) && (second_val === db_val)) ) {
        console.error(`[FAIL] db val should be updated: ${first_val} ${second_val} ${db_val}`);
    } else {
        console.log(`[OK] db val is updated: ${first_val} ${second_val} ${db_val}`);
    }

    // test that the cache file exists
    let cache_file_name = config.database_path + db_js.cache_file_name;
    if (fs.existsSync(cache_file_name)) {
        console.log(`[OK] cache_file_name should exist: ${cache_file_name}`);
        // check that cache file is empty
        if (JSON.parse(fs.readFileSync(cache_file_name).toString()).length !== 0) {
            console.error(`[FAIL] ${cache_file_name} should be empty`);
        } else {
            console.log(`[OK] ${cache_file_name} is empty`);
        }
    } else {
        console.error(`[FAIL] cache_file_name does not exist: ${cache_file_name}`);
    }

    // test that large keys cannot be set
    let huge_key = randomString(1050);
    let random_val = randomString(7);
    let retval = db_js.set(huge_key, random_val);
    if (retval === true) {
        console.error(`[FAIL] huge key cannot be accepted`);
    } else {
        console.log(`[OK] huge key was not accepted: ${retval}`);
    }

    // test that non serializable values cannot be set
    let some_key = randomString(7);
    let retval2 = db_js.set(some_key, DBjs);
    if (retval2 === true) {
        console.error(`[FAIL] unserializable obj util cannot be accepted`);
    } else {
        console.log(`[OK] unserializable obj util was not accepted: ${retval2}`);
    }

    // test that keys with invalid type cannot be set
    let random_val2 = randomString(7);
    let retval3 = db_js.set([], random_val2);
    if (retval3 === true) {
        console.error(`[FAIL] [] as key cannot be accepted`);
    } else {
        console.log(`[OK] [] as key cannot be accepted: ${retval3}`);
    }

    // test that keys with invalid type cannot be used in get
    let retval4 = db_js.get([1,2,3]);
    if (retval4 !== undefined) {
        console.error(`[FAIL] [1,2,3] as key cannot be accepted in get()`);
    } else {
        console.log(`[OK] [1,2,3] as key cannot be accepted in get(): ${retval4}`);
    }

    // Test that the cache is written to disk after `flush_interval` seconds
    setTimeout(async function() {
        if (fs.existsSync(cache_file_name)) {
            console.log(`[OK] cache file ${cache_file_name} exists after ${config.flush_interval} seconds`);
            if (JSON.parse(fs.readFileSync(cache_file_name).toString()).length !== (num_to_insert + 1)) {
                console.error(`[FAIL] ${cache_file_name} should have length ${num_to_insert + 1}`);
            } else {
                console.log(`[OK] cache file ${cache_file_name} has exactly ${num_to_insert + 1} elements`);
            }
        } else {
            console.error(`[FAIL] cache file ${cache_file_name} should exist after ${config.flush_interval} seconds`);
        }
    }, (config.flush_interval * 1000) + 250);

    let archive_file_name = config.database_path + config.file_prefix + db_js.cache_file_name;

    // Test that the written cache file is persisted after `persist_after_seconds` seconds
    // and now has a prefix `file_prefix`
    setTimeout(async function() {
        if (fs.existsSync(archive_file_name)) {
            console.log(`[OK] archived cache file ${archive_file_name} exists after ${config.persist_after_seconds} seconds`);
            if (JSON.parse(fs.readFileSync(archive_file_name).toString()).length !== (num_to_insert + 1)) {
                console.error(`[FAIL] archived file ${archive_file_name} should have length ${num_to_insert + 1}`);
            } else {
                console.log(`[OK] archived file ${archive_file_name} has exactly ${num_to_insert + 1} elements`);
            }

            // test a new cache file was also created
            let new_cache_file_name = config.database_path + db_js.cache_file_name;
            if (fs.existsSync(new_cache_file_name)) {
                console.log(`[OK] new_cache_file_name should exist: ${new_cache_file_name}`);
                // check that cache file is empty
                if (JSON.parse(fs.readFileSync(new_cache_file_name).toString()).length !== 0) {
                    console.error(`[FAIL] new_cache_file_name ${new_cache_file_name} should be empty`);
                } else {
                    console.log(`[OK] new_cache_file_name ${new_cache_file_name} is empty`);
                }
            } else {
                console.error(`[FAIL] new_cache_file_name does not exist: ${new_cache_file_name}`);
            }

            // test that the index was updated!
            
        } else {
            console.error(`[FAIL] archived cache file ${archive_file_name} should exist after ${config.persist_after_seconds} seconds`);
        }
        // close dbjs isntance
        db_js.close();

        // test that the database is in a clean state
        // confirm that we can create a new client and that 
        // all key/value pairs where added in the previous session.
        config.debug = false;
        let new_db_js = new DBjs(config);

        // test that the index size is correct
        const expteced_size = (initial_index_size + num_to_insert + 1);
        if (new_db_js.cache_size() !== expteced_size) {
            console.error(`[FAIL] new_db_js.index_size() should have size: ${expteced_size}`);
        } else {
            console.log(`[OK] new_db_js.index_size() should have grown to ${expteced_size}`);
        }

        if (new_db_js.cache_size() !== 0) {
            console.error(`[FAIL] initial_cache_size must be zero. (initial_cache_size=${initial_cache_size})`);
        } else {
            console.log(`[OK] initial_cache_size=${initial_cache_size}`)
        }

        // test that we can obtain exactly those values that we have inserted before
        // with the new instance
        for (let obj of to_insert) {
            let retval = new_db_js.get(obj[0]);
            if (retval !== obj[1]) {
                console.error(`[FAIL] new_db_js.get() should have returned ${obj} but returned ${retval}`);
            } else {
                console.log(`[OK] new_db_js.get() works as intended`);
            }
        }

        for (let obj of to_insert.reverse()) {
            let retval = new_db_js.get(obj[0]);
            if (retval !== obj[1]) {
                console.error(`[FAIL] reverse new_db_js.get() should have returned ${obj} but returned ${retval}`);
            } else {
                console.log(`[OK] reverse new_db_js.get() works as intended`);
            }
        }

        correct_order(new_db_js, keys);

        new_db_js.close();
    }, (config.flush_interval * 2 * 1000) + 250);
})();