# db.js

db.js allows you to work with a key/value data without caring about data persistance and storage.

All that db.js gives you is a key/value store. db.js persists data to disk as JSON files periodically and safely.

```js
const DBjs = require('./index').DBjs;

let db_js = new DBjs();

db_js.set('4343', {'name': 'test'});

console.log(db_js.get('4343'));

db_js.close();
```

## Design Principles

From the many quick & dirty programming projects I have done in the past, I observed that I often need the following capabilities from databases:

1. Recently stored data should be kept in an in-memory cache, since recent data is queried/updated more often than old data.
2. I like to store data as JSON in files, since the performance benefits of other data formats don't outweight the easiness to work with JSON.
3. I don't want to care about when/why/where to persist data. This should be done by db.js in the background in a safe and consistent manner.
4. No complex SQL query semantic is needed. In fact, the only way I need to query data is:
  - based on a time range `(ts0, ts1)`
  - based on an index slice range `(start, stop)`
  - and if I don't specify any selection criteria, then db.js should just return the memory cache contents

## API

The db.js API has four methods:

`set(key, value)` - Assigns the `value` to the `key` in the storage. If the `key` is already in the database, the value will be overwritten/updated. keys are unique.

`get(key)` - Returns the `value` associated with `key` from the storage. Lookup time: O(1)

`getn(index_range, time_range)` - Returns an array of values in insertion order. This means that the most recent inserted value (Inserted with `set(key, value)`) is returned as first element of the array. When both `index_range=null` and `time_range=null`, then `getn()` returns the memory cache contents by default.

The variable `index_range` selects values to be returned by index range. If you specify `index_range=[0, 500]`, then the last 500 inserted values are returned.

The variable `time_range` selects values to be returned by an timestamp range. If you specify `time_range=[1649418657952, 1649418675192]`, then the items that were inserted between those two timestamps will be returned.

`size()` - Returns the size of the database.

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