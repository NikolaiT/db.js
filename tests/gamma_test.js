const DBjs = require('../dbjs').DBjs;
const util = require('util');
const fs = require('fs');
const exec = util.promisify(require('child_process').exec);
const {correct_order, assert, randomString, insert_with_delay, sleep} = require('./test_utils');

// what happens when we write a bit delayed and dbjs.js is flushing and storing inbetween?
// can i provoke some errors?

async function gamma_test() {
    await exec('rm -rf ./gamma_db/ && rm -f gamma_logfile.log');

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

    let inserted_items = [];
    let keys = [];
    let n = 21;

    for (let i = 0; i < n; i++) {
        const random_key = randomString(7);
        const random_value = randomString(10);
        inserted_items.push([random_key, random_value]);
        keys.push(random_key);
        let delay = Math.ceil(Math.random() * 1000)
        await insert_with_delay(db_js, delay, random_key, random_value);
    }

    console.log('Done inserting items');
    correct_order(db_js, keys, true);

    // exactly `n` writes occurred
    const cache_writes = db_js._file_cache_write_counter + db_js._memory_cache_write_counter;
    assert(cache_writes === n, `exactly n writes occurred (${db_js._file_cache_write_counter}, ${db_js._memory_cache_write_counter})`);

    const cache_reads = db_js._file_cache_read_counter + db_js._memory_cache_read_counter;
    // exactly 0 reads occurred
    assert(cache_reads === 0, 'exactly 0 reads occurred: ' + cache_reads);

    db_js.close()

    let new_db_js = new DBjs(config);
    correct_order(new_db_js, keys, true);

    // - write test to really check that most recently inserted element is returned as first with getn()

    const all = new_db_js.getn([0, 1000]);

    assert(all[0] === inserted_items[inserted_items.length-1][1], 'most recently inserted element is returned as first with getn()');

    assert(all[all.length-1] === inserted_items[0][1], '(reverse) most recently inserted element is returned as first with getn()');

    // - Test edgecase in archived file: last element in last archived file is the first inserted element ever
    let files = new_db_js._getFiles(false)
    let filepath = config.database_path + files[files.length-1]
    let data = JSON.parse(fs.readFileSync(filepath).toString())
    assert(inserted_items[0][1] === data[data.length-1], 'last element in last archived file is the first inserted element ever');

    // now let's see what happens when I stres test the whole thing
    let stresstest = [];
    while (true) {
        await sleep(15);
        const random_key = randomString(7);
        const random_value = randomString(10);
        stresstest.push([random_key, random_value]);
        new_db_js.set(random_key, random_value);
        console.log('stresstest', random_key, random_value);
    }

    new_db_js.close()
}

gamma_test()