function randomString(length=100) {
    let str = '';
    for (let i = 0; i < length; i++) {
        str += String.fromCharCode(Math.floor(65 + Math.random() * 25));
    }
    return str;
}

function assert(test_condition, msg) {
    if (test_condition) {
        console.log('[OK] ' + msg);
    } else {
        console.error(`[FAIL] ` + msg);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function insert_with_delay(dbjs, delay, key, value) {
    await sleep(delay);
    dbjs.set(key, value);
}

// test that keys were in an order such that first inserted key
// has oldest timestamp and lowest index
function correct_order(db_js, keys, strict=false) {
    let metadata = [];
    for (let key of keys) {
        metadata.push(db_js._get_key_index_entry(key));
    }

    for (let i = 0; i < metadata.length - 1; i++) {
        // console.log(metadata[i], metadata[i+1])
        assert(metadata[i].i + 1 === metadata[i+1].i, 'indices must be monotonically increasing')
        if (strict) {
            assert(metadata[i].c < metadata[i+1].c, 'ts must be strictly monotonically decreasing')
        } else {
            assert(metadata[i].c <= metadata[i+1].c, 'ts must be monotonically decreasing')
        }
    }

    // test that first metadata is smaller than last
    assert(metadata[0].c <= metadata[metadata.length-1].c, 'last timestamp is larger than first')
    assert(metadata[0].i < metadata[metadata.length-1].i, 'last index is surely larger than first')
}

module.exports.randomString = randomString;
module.exports.assert = assert;
module.exports.correct_order = correct_order;
module.exports.insert_with_delay = insert_with_delay;
module.exports.sleep = sleep;