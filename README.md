# db.js

db.js allows you to work with a key/value data without caring about data persistance and storage.

All that db.js gives you is a key/value store. db.js persists data to disk as JSON files periodically and safely.

```js
const DBjs = require('./dbjs').DBjs;

let db_js = new DBjs();

db_js.set('4343', {'name': 'test'});

console.log(db_js.get('4343'));

db_js.close();
```

Of course `db.js` has many different configuration options that you can use:

```js
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
```

## Design Principles

From the many quick & dirty programming projects I have done in the past, I observed that I often need the following capabilities from databases:

1. **In-Memory**: Recently stored data should be kept in an in-memory cache, since recent data is read and updated way more frequently than old data. This observation is **paramount!**
2. **Key-Value semantics:** I like to associate the stored object with an unique key. Therefore, I like to work with key-value storages.
3. **JSON Format**: I like to store data as JSON in files, since the performance benefits of other data formats don't outweight the easiness to work with JSON. Put differently: I just don't have the time to learn any other data format than JSON. JSON is easily readable and that's what matters most. Everyone understands JSON. There are other things such BSON, but no one really cares about it.
4. **Persistance:** I don't want to care about when/why/where to persist data. This should be done by `db.js` in the background in a safe and consistent manner. Data is persisted to simple JSON files after the memory-cache reaches a certain age or size.
5. **No SQL required:** No complex SQL query semantic is needed. In fact, the only way I need to query data is:
    + base on a key with lookup time `O(1)`
    + based on a time range `(ts0, ts1)` where `ts0` and `ts1` are both timestamps
    + based on an index range `(start, stop)` where `start` and `stop` are both integers
    + if I don't specify any selection criteria, then `db.js` should just return the memory cache contents (lookup time `O(1)`)
6. **Data does not need to be deleted:** I don't care about deleting data. Delete operations are hard to implement, since a delete operation requires an index and reverse index update. In fact, providing a delete operation doesn't outweigh the complexity introduced by its implementation.

## db.js API

The db.js API currently has five main API methods:

#### set(key, value)

`set(key, value)` - Assigns the `value` to the `key` in the storage. If the `key` is already in the database, the value will be overwritten. keys are unique.

#### get(key)

`get(key)` - Returns the `value` associated with `key` from the storage. The lookup time is `O(1)`.

#### getn(index_range, time_range)

`getn(index_range, time_range)` - Returns an array of values in insertion order. This means that the most recent inserted value (Inserted with `set(key, value)`) is returned as first element of the array. When both `index_range=null` and `time_range=null` are set to `null`, then `getn()` returns the memory cache contents by default.

The variable `index_range` selects values to be returned by index range. If you specify `index_range=[0, 500]`, then the last 500 inserted values are returned.

The variable `time_range` selects values to be returned by an timestamp range. If you specify `time_range=[1649418657952, 1649418675192]`, then the items that were inserted between those two timestamps will be returned.

#### index_size()

`index_size()` - Returns the index size of the database. This is equivalent to the number of all database entries and thus the size of the database.

#### cache_size()

`cache_size()` - Returns the cache size of the database. The cache includes all database entries that are kept in memory.

## TODO

- add a test case in alpha where we update two values in two different database files and check that the file size stays the same before and after the update.

- if index is smaller than 20.000 entries, pretty print it.

- When updating or inserting values, sometimes we insert empty values in the array. Very bad. [done]

```js
> a[100] = 99
99
> a
[ 12, 3, 4, <97 empty items>, 99 ]
> a[5]
undefined
> JSON.stringify(a0
... 
> JSON.stringify(a)
'[12,3,4,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,99]'
```

- should API functions be async? Reason: When flushing/persisting to disk, set(), get() and getn() 
  should wait. Otherwise the state might be destroyed.

- add a lock persisting and flushing files. [done]
- write test to really check that most recently inserted element is returned as first with getn() [done]
- Test edgecase in archived file: Most recent inserted element in file is returned earliest [done]

- add capability to getn() to query data based on dateformat [done]
  => Bad idea. Only allow to specify timestampts obtained with `(new Date()).getTime()`

- archived file should store data in the correct order! better speed. [done]
  Use array.unshift() instead of push() [done]

- logfile must be in db.js folder by default [done]

- add functionality in getn() to get a slice of data based on index interval [i, j] [done]
- add functionality in getn() to get a slice of data based on ts interval [ts1, ts2] [done]

- getn() never should load from persisted memory cache file, only from archived files! [done]

- When dbjs.js is aborted/terminated, make sure that data is persisted in a safe way! [done]

- Return data with getn() in a way such that the first element is the most recent and the last returned value is the oldest!!! [done]
- Why does getn() not return data in creation order??? [done]

- if the memory cache is persisted on disk, dbjs.js has to load it in memory and on 
  subsequent getn() requests, no disk read should occur. [done]

- dbjs.js `log()` DONT LOG TO FILE, too slow