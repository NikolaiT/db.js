const fs = require('fs');
const path = require('path');

/**
 * 
 * Author: Nikolai Tschacher
 * Date: April/Mai 2022
 * Website: incolumitas.com
 * Copyright: All rights reserved (c)
 * 
 */

function round(number, decimalPlaces) {
    const factorOfTen = Math.pow(10, decimalPlaces);
    return Math.round(number * factorOfTen) / factorOfTen;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class DBjs {
    constructor(user_config = {}) {
        if (user_config && typeof user_config !== 'object') {
            throw Error('user_config must be of type object');
        }

        this.config = {
            // after what size in MB the memory cache should be written to disk
            persist_after_MB: 20,
            // after what time in seconds the memory cache should be written to disk
            persist_after_seconds: 12 * 60 * 60,
            // relative path to database directory
            database_path: './database/',
            // where to log debug outputs to
            logfile_path: './dbjs.log',
            // after how many seconds should the cache and index be persisted
            flush_interval: 5 * 60,
            // file prefix for archived files
            file_prefix: 'dbjs_',
            // whether to print debug messages
            debug: true,
            // max key size
            max_key_size_bytes: 1024,
            // max value size
            max_value_size_bytes: 1048576,
        };

        // set logfile key as first
        if (user_config.logfile_path != undefined) {
            this.config.logfile_path = user_config.logfile_path;
        }

        for (let key in this.config) {
            if (user_config[key] !== undefined) {
                this._log(`db.js - overwriting config key ${key}=${user_config[key]}`);
                this.config[key] = user_config[key];
            }
        }

        this._check_config();

        this.cache = [];
        let self = this;

        this.flush_interval_id = setInterval(function () { 
            self._persist() 
        }, (this.config.flush_interval * 1000));

        // used to know when to archive the cache 
        this.started = (new Date()).getTime();

        if (!fs.existsSync(this.config.database_path)) {
            this._log(`db.js - creating database folder ${this.config.database_path}`);
            fs.mkdirSync(this.config.database_path);
        }

        this._load_cache();
        this.index = this._load_index();
        this.rindex = this._load_index('rindex.json');
        this.meta = this._load_meta();

        this._consistency_checks();

        // cache hit counters
        // increment when an item was read from memory
        this._memory_cache_read_counter = 0;
        // increment when an item was written in memory
        this._memory_cache_write_counter = 0;
        // increment when an value was read from disk
        this._file_cache_read_counter = 0;
        // increment when a value was written to disk
        this._file_cache_write_counter = 0;

        // used to prevent inconsistent database state 
        // when persisting data
        this._persist_lock = false;

        this.info();

        this.on_kill_called = false;

        const event_types = [`SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`];
        this.kill_event_listeners = {};
        // https://stackoverflow.com/questions/14031763/doing-a-cleanup-action-just-before-node-js-exits
        for (let event_type of event_types) {
            this.kill_event_listeners[event_type] = this._on_kill.bind(this, event_type);
            process.on(event_type, this.kill_event_listeners[event_type]);
        }
    }

    _on_kill(event, args) {
        this._log(`db.js - _on_kill() - ${event}`);
        if (event === `uncaughtException`) {
            this._log(`db.js - _on_kill() - ${event} - ${args}`);
        }
        if (this.on_kill_called === false) {
            this.on_kill_called = true;
            clearInterval(this.flush_interval_id);
            this._persist();
            process.exit();
        }
    }

    /**
     * Closes the active dbjs.js session after persisting the state.
     * 
     * Closing means that we can remove all SIGINT/SIGTERM handlers.
     * 
     * The flush interval can also be cleared.
     */
     close() {
        this._log(`db.js - close()`);
        // persist
        this._persist();
        for (let event_type in this.kill_event_listeners) {
            process.removeListener(event_type, this.kill_event_listeners[event_type]);
        }
        clearInterval(this.flush_interval_id);
    }

    /**
     * Return all kinds of metadata for the dbjs.js database.
     */
    info() {
        this._log(`[INFO] - Config: ` + JSON.stringify(this.config, null, 2));

        this._log(`[INFO] - Database path: ${this.config.database_path}`);
        this._log(`[INFO] - Database archive prefix: ${this.config.file_prefix}`);

        this._log(`[INFO] - Database index size: ${this.index_size()}`);
        this._log(`[INFO] - Database reverse index size: ${this.rindex_size()}`);

        this._log(`[INFO] - Cache size: ${this.cache_size()}`);

        let files = this._getFiles(true);
        this._log(`[INFO] - Database files (most recently created file first, oldest file last): ` + files);

        for (let file of files) {
            let contents = fs.readFileSync(this._path(file)).toString();
            let parsed_data = JSON.parse(contents);
            this._log(`[INFO] - File: ${file} - Length: ${parsed_data.length}`);
        }

        const counters_str = JSON.stringify({
            memory_cache_read_counter: this._memory_cache_read_counter,
            memory_cache_write_counter: this._memory_cache_write_counter,
            file_cache_read_counter: this._file_cache_read_counter,
            file_cache_write_counter: this._file_cache_write_counter,
        }, null, 2);
        this._log(`[INFO] - Counters: ${counters_str}`);
    }

    /**
     * Sets the value in dbjs.js
     * 
     * @param {*} key 
     * @param {*} value 
     * @returns true if the value could be set, else false
     */
    set(key, value) {
        if (this._check_key(key) !== 1) {
            return false;
        }

        if (this._check_value(value) !== 1) {
            return false;
        }

        this._wait_persist_lock();

        // update value
        if (this.index[key]) {
            const cache_index = this._get_memory_cache_index(key);
            if (cache_index !== -1) {
                this._log(`db.js - updating key (${key}) in memory cache`);
                if (cache_index >= 0 && cache_index <= this.cache.length) {
                    this.cache[cache_index] = value;
                } else {
                    this._log(`db.js - cannot update index ${cache_index} larger than cache (${this.cache.length})`);
                }
                this._memory_cache_write_counter++;
            } else {
                this._log(`db.js - updating key (${key}) value in file.`);
                this._update_file(key, value);
            }
        } else {
            this.cache.unshift(value);
            this._memory_cache_write_counter++;
            let index = this.index_size();
            this.index[key] = {
                i: index,
                f: this.cache_file_name,
                c: (new Date()).getTime(),
            };
            this.rindex[index] = key;
        }

        return true;
    }

    /**
     * The last inserted cache item has the largest index.
     * 
     * @param {*} key 
     * @returns 
     */
    get(key) {
        if (this._check_key(key) !== 1) {
            return undefined;
        }

        this._wait_persist_lock();

        if (this.index[key]) {
            const cache_index = this._get_memory_cache_index(key);
            if (cache_index !== -1) {
                this._memory_cache_read_counter++;
                return this.cache[cache_index];
            } else {
                return this._load_from_file(key);
            }
        }

        return undefined;
    }

    /**
     * Only for debugging/testing purposes.
     * 
     * Returns the index metadata for a given key.
     * 
     * @param {*} key 
     */
    _get_key_index_entry(key) {
        if (this.index[key]) {
            return this.index[key];
        }

        return undefined;
    }

    /**
     * If the key is currently residing in the memory cache, return 
     * it's index, else return -1.
     * 
     * @param {} key 
     */
    _get_memory_cache_index(key) {
        if (this.index[key]) {
            let cache_index = this.index_size() - (this.index[key].i + 1);
            if (cache_index < this.cache_size()) {
                return cache_index;
            }
        }
        return -1;
    }

    get_cache() {
        return this.cache;
    }

    /**
     * `getn(index_range, time_range)` - Returns an array of values in insertion order.
     * 
     * This means that the most recent inserted value (Inserted with `set(key, value)`) is
     * returned as first element of the array. 
     * When both `index_range=null` and `time_range=null`, then `getn()`
     * returns the memory cache contents by default.
     *
     * The variable `index_range` selects values to be returned by index range.
     * If you specify `index_range=[0, 500]`, then the last 500 inserted values are returned.
     *
     * The variable `time_range` selects values to be returned by an timestamp range.
     * If you specify `time_range=[1649418657952, 1649418675192]`,
     * then the items that were inserted between those two timestamps will be returned.
     * 
     * @param {*} index_range 
     * @param {*} time_range
     *  
     * @returns A list of values in the storage, sliced by the selecton criteria
     */
    getn(index_range=null, time_range=null) {
        let start_index = 0;
        let end_index = this.cache_size();
        let size = this.index_size();

        this._wait_persist_lock();

        if (index_range !== null) {
            if (Array.isArray(index_range) && index_range.length === 2) {
                start_index = index_range[0];
                end_index = index_range[1];
            } else {
                this._log(`db.js - getn() - invalid index_range`);
                return [];
            }
        }

        if (time_range !== null) {
            if (Array.isArray(time_range) && time_range.length === 2) {
                start_index = this._binary_search_index(time_range[0]) + 1;
                end_index = this._binary_search_index(time_range[1]) + 1;
            } else {
                this._log(`db.js - getn() - invalid time_range`);
                return [];
            }
        }

        // if we are overshooting, just return all data
        if (end_index > size || start_index > size) {
            this._log(`db.js - getn() - start_index=${start_index}, end_index=${end_index} cannot be larger than index size ${size}`);
            start_index = 0;
            end_index = size;
        }

        // check we have correct start_index and end_index
        if (start_index < 0 || end_index < 0 || start_index > end_index) {
            this._log(`db.js - getn() - invalid indices: (start_index=${start_index}, end_index=${end_index})`);
            return [];
        }

        this._log(`db.js - getn() - start_index=${start_index}, end_index=${end_index}`);

        // first get from in-memory cache
        // and see if this already thresholds our limits
        if (end_index <= this.cache.length) {
            // we can serve from in-memory cache only
            this._memory_cache_read_counter++;
            return this.cache.slice(start_index, end_index);
        } else {
            // we have to load from archived database files
            let key = this.rindex[(size - end_index).toString()];
            if (key) {
                let up_to_file = this.index[key].f;
                let files = this._getFiles(false);
                let to_load = [];
                let i = 0;
                while (i < files.length) {
                    let file = files[i];
                    to_load.push(file);
                    i++;
                    if (file.indexOf(up_to_file) !== -1) {
                        break;
                    }
                }
                this._log(`db.js - to_load from files: ${to_load}`);
                this._log(`db.js - getn() has to load from disk ${i}/${files.length} up to file ${up_to_file}`);

                let retval = this.cache;
                this._memory_cache_read_counter++;

                for (let file of to_load) {
                    let contents = fs.readFileSync(this._path(file)).toString();
                    this._file_cache_read_counter++;
                    let parsed_data = JSON.parse(contents);
                    retval = retval.concat(parsed_data);
                }

                return retval.slice(start_index, end_index);;
            } else {
                this._log(`db.js - retn=${retn} not in rindex`);
            }
        }

        return [];
    }

    /**
     * Return everything until the limit is reached.
     * 
     * @param {*} limit 
     * @returns 
     */
    _getn(limit=1000) {
        this._log(`db.js - _getn()`);
        let retval = this.cache;
        this._memory_cache_read_counter++;

        if (retval.length > limit) {
            return retval;
        }
        
        let files = this._getFiles(false);
        this._log(`db.js - _getn() - files: ${files}`);

        for (let file of files) {
            let contents = fs.readFileSync(this._path(file)).toString();
            this._file_cache_read_counter++;
            let parsed_data = JSON.parse(contents);
            retval = retval.concat(parsed_data);
            this._log(`db.js - retval length: ${retval.length}`);
            if (retval.length > limit) {
                return retval;
            }
        }

        return retval;
    }

    _isFunction(functionToCheck) {
        return functionToCheck && {}.toString.call(functionToCheck) === '[object Function]';
    }

    /**
     * Walk over all files and apply a callback on the parsed result.
     * 
     * @param {*} callbacks - an array of callbacks to apply
     * @param {int} limit - after how many items to stop
     * @returns 
     */
    walk(callbacks, limit=1000) {
        this._log(`db.js - walk()`);

        let files = this._getFiles(false);
        let num = 0;

        // first lookup in cache
        this._memory_cache_read_counter++;
        for (let callback of callbacks) {
            if (this._isFunction(callback)) {
                callback(this.cache);
            } else {
                this._log(`db.js - callback is not a function...`);
            }
        }

        num += this.cache.length;

        if (Number.isInteger(limit) && num >= limit) {
            return true;
        }

        for (let file of files) {
            this._log(`db.js - walk() - apply callback on file: ${file}`);
            let contents = fs.readFileSync(this._path(file)).toString();
            this._file_cache_read_counter++;
            let parsed_data = JSON.parse(contents);
            num += parsed_data.length;

            for (let callback of callbacks) {
                if (this._isFunction(callback)) {
                    callback(parsed_data);
                } else {
                    this._log(`db.js - callback is not a function...`);
                }
            }

            if (Number.isInteger(limit) && num >= limit) {
                break;
            }
        }

        return true;
    }

    /**
     * Apply a callback str on all results.
     * 
     * @param {*} callback 
     * @param {*} limit 
     */
    filter(callback_str, limit=1000) {
        this._log(`db.js - filter()`);

        let files = this._getFiles(false);
        let num = 0;
        let results = [];
        let obj = {};

        // first lookup in cache
        this._memory_cache_read_counter++;
        for (let data of this.cache) {
            if (data) {
                try {
                    eval(callback_str);
                } catch (err) {
                    return err.toString();
                }
            }
        }

        num += this.cache.length;

        if (Number.isInteger(limit) && num >= limit) {
            return results;
        }

        for (let file of files) {
            this._log(`db.js - filter() - apply callback on file: ${file}`);
            let contents = fs.readFileSync(this._path(file)).toString();
            this._file_cache_read_counter++;
            let parsed_data = JSON.parse(contents);
            num += parsed_data.length;

            for (let data of parsed_data) {
                if (data) {
                    try {
                        eval(callback_str);
                    } catch (err) {
                        return err.toString();
                    }
                }
            }

            if (Number.isInteger(limit) && num >= limit) {
                break;
            }
        }

        return {
            results: results,
            obj: obj,
        };
    }

    /**
     * 
     * @returns returns the index size
     */
    index_size() {
        return Object.keys(this.index).length;
    }

    /**
     * 
     * @returns returns the memory cache size
     */
    cache_size() {
        return this.cache.length;
    }

    /**
     * 
     * @returns returns the reverse index size
     */
     rindex_size() {
        return Object.keys(this.rindex).length;
    }

    _log(msg, level='INFO', throw_error=false) {
        if (this.config.debug) {
            let ts = (new Date()).toLocaleString();
            let output = `[${ts}] - ${level} - ${msg}`;
            fs.appendFileSync(this.config.logfile_path, output + '\n');
            console.log(output);
        }
        if (throw_error) {
            throw Error(msg);
        }
    }

    _binary_search_index(ts) {
        let insertion_times = [];
        for (let key in this.index) {
            insertion_times.push(this.index[key].c);
        }

        let [start, end] = this._binary_search(insertion_times, ts);

        return end;
    }

    _binary_search(sortedArray, key) {
        let start = 0;
        let end = sortedArray.length - 1;
    
        while (start <= end) {
            let middle = Math.floor((start + end) / 2);
    
            if (sortedArray[middle] === key) {
                // found the key
                // return middle;
                break;
            } else if (sortedArray[middle] < key) {
                // continue searching to the right
                start = middle + 1;
            } else {
                // search searching to the left
                end = middle - 1;
            }
        }
    
        return [start, end];
    }

    /**
     * Check whether the key can be used in dbjs.js
     * 
     * key must be of type string
     * key must be smaller than `max_key_size_bytes`
     * 
     * @param {*} key 
     * @returns -1 if the key is not valid, else 1
     */
    _check_key(key) {
        if (typeof key !== 'string') {
            return -1;
        }

        if (key.length > this.config.max_key_size_bytes) {
            return -1;
        }

        return 1;
    }

    /**
     * 
     * value must be serializable to JSON
     * value must be smaller than `max_value_size_bytes`
     * 
     * @param {*} value 
     * @returns -1 if the value is not valid, else 1
     */
    _check_value(value) {
        let stringified;

        try {
            stringified = JSON.stringify(value);
        } catch(err) {
            this._log(`db.js - _check_value() value not serializable: ${err.message}`);
            return -1;
        }

        if (typeof stringified !== 'string') {
            return -1;
        }

        if (stringified.length > this.config.max_value_size_bytes) {
            return -1;
        }

        return 1;
    }

    _update_file(key, value) {
        let path = this._path(this.index[key].f, true);

        if (fs.existsSync(path)) {
            let contents = fs.readFileSync(path).toString();
            this._file_cache_read_counter++;
            let parsed = JSON.parse(contents);
            const file_index = this._get_archived_index(this.index[key].i, this.index[key].f, parsed.length);
            if (file_index >= 0 && file_index <= parsed.length) {
                parsed[file_index] = value;
                fs.writeFileSync(path, JSON.stringify(parsed));
                this._file_cache_write_counter++;
            } else {
                this._log(`db.js - file_index (${file_index}) is larger than file contents (${parsed.length})`);
            }
        } else {
            this._log(`db.js - _update_file() file ${path} does not exist`);
        }

        return null;
    }

    /**
     * Load the key from the archived file.
     * 
     * @param {*} key 
     * @returns 
     */
    _load_from_file(key) {
        let path = this._path(this.index[key].f, true);

        if (fs.existsSync(path)) {
            let contents = fs.readFileSync(path).toString();
            this._file_cache_read_counter++;
            let parsed = JSON.parse(contents);
            const file_index = this._get_archived_index(this.index[key].i, this.index[key].f, parsed.length);
            return parsed[file_index];
        } else {
            this._log(`db.js - _load_from_file() file ${path} does not exist`);
        }

        return null;
    }

    _get_archived_index(index, file, length) {
        let offset = 0;
        for (let archive_file in this.meta.archive) {
            if (archive_file.indexOf(file) !== -1) {
                break;
            }
            offset += this.meta.archive[archive_file].size;
        }
        let file_index = index - offset;
        this._log(`db.js - _get_archived_index() index=${index}, file=${file}, offset=${offset}, file_index=${file_index}`);
        return (length - 1) - file_index;
    }

    _flush_meta_file() {
        const meta_path = this._path('meta.json');
        fs.writeFileSync(meta_path, JSON.stringify(this.meta, null, 2));
    }

    /**
     * Flushes cache/index/reverse index to disk.
     * 
     * This method does not alter the state of cache/index/reverse index.
     * 
     * @returns 
     */
    _flush() {
        this._log(`db.js - _flush() - Storing cache/index/reverse index`);
        // 1. save cache
        let stringified = JSON.stringify(this.cache);

        if (this.cache_size() > 0) {
            // flush cache contents
            fs.writeFileSync(this._path(this.cache_file_name), stringified);
        }

        // 2. save index
        const index_path = this._path('index.json');
        let stringified_index = (this.index_size() > 10000) ? JSON.stringify(this.index) : JSON.stringify(this.index, null, 2);
        fs.writeFileSync(index_path, stringified_index);

        // 3. save reverse index
        const rindex_path = this._path('rindex.json');
        let stringified_rindex = (this.rindex_size() > 10000) ? JSON.stringify(this.rindex) : JSON.stringify(this.rindex, null, 2);
        fs.writeFileSync(rindex_path, stringified_rindex);

        // 4. save meta.json
        this._flush_meta_file();

        return stringified;
    }

    _wait_persist_lock() {
        // this is very ugly but I don't currently have a better idea
        while (this._persist_lock === true) {
            console.log(`db.js - _wait_persist_lock() ...`);
            (async () => {
                await sleep(10);
            })();
        }
    }

    /**
     * If conditions apply, persist in-memory cache to disk.
     * 
     * This alters the state of this.cache.
     * 
     * While _persist() is running, no API operation is allowed to run (set(), get(), getn()).
     */
    _persist() {
        this._persist_lock = true; // lock on

        let stringified = this._flush();
        this._log(`db.js - _persist()`);

        // archive current cache based on cache size?
        const mbsize = round(Buffer.byteLength(stringified) / (1024 * 1024), 3);
        this._log(`db.js - cache size:  ${mbsize}mb`);

        // archive current cache based on passed time?
        const delta = ((new Date()).getTime() - this.started) / 1000;
        this._log(`db.js - delta:  ${delta}s`);

        const space_exceeded = mbsize >= this.config.persist_after_MB;
        if (space_exceeded) {
            this._log(`db.js - Storage space exceeded threshold: cache size: ${mbsize}mb`);
        }
        const time_exceeded = (delta >= this.config.persist_after_seconds);
        if (time_exceeded) {
            this._log(`db.js - Cache age exceeded time threshold: ${this.config.persist_after_seconds}s`);
        }

        const archive = (space_exceeded || time_exceeded);

        // only archive an non-empty cache
        if (archive && this.cache_size() > 0) {
            const archived_name = path.join(
                this.config.database_path,
                this.config.file_prefix + this.cache_file_name,
            );
            fs.renameSync(this._path(this.cache_file_name), archived_name);
            this._log(`db.js - Archived file with ${this.cache_size()} stored objects ${this.cache_file_name} --> ${archived_name}`);
            this.meta.archive[this.config.file_prefix + this.cache_file_name] = {
                size: this.cache_size(),
            }
            // we have to flush the meta file since _persist() could be 
            // the last operation in the lifecycle
            this._flush_meta_file();
            this._create_cache_file();
            // reset the started counter
            this.started = (new Date()).getTime();
        }

        this._persist_lock = false; // lock off
    }

    _path(file_name, archived=false) { 
        if (archived) {
            return path.join(this.config.database_path, this.config.file_prefix + file_name);
        } else {
            return path.join(this.config.database_path, file_name);
        }
    }

    _create_cache_file() {
        this.cache_file_name = (new Date()).getTime() + '.json';
        this.cache = [];
        fs.writeFileSync(this._path(this.cache_file_name), JSON.stringify(this.cache));
    }

    _load_cache() {
        let files = this._getFiles(true);

        // actual cache file is the one without the prefix file_prefix
        let actual = null;

        for (let file of files) {
            if (file && file.indexOf(this.config.file_prefix) === -1) {
                actual = file;
                break;
            }
        }

        if (actual && fs.existsSync(this._path(actual))) {
            this.cache = JSON.parse(fs.readFileSync(this._path(actual)).toString());
            this.cache_file_name = actual;
            this._log('db.js - Loaded cache from file ' + this.cache_file_name);
        } else {
            this._log('db.js - Creating fresh/empty cache file ' + this.cache_file_name);
            this._create_cache_file();
        }
    }

    /**
     * Return archived files from database directory in order of creation: 
     * most recently created file first, oldest file last
     * 
     * The age of the file is derived of it's name.
     * 
     * dbjs_1648820673048.json > Friday, 1 April 2022 15:44:33.048
     * dbjs_1648980673605.json > Sunday, 3 April 2022 12:11:13.605
     * 
     * order: [dbjs_1648980673605.json, dbjs_1648820673048.json]
     * 
     * @returns files in order of creation (most recently created file first, oldest file last)
     */
    _getFiles(include_memory_cache_file=false) {
        let self = this;
        // ignore index files
        const ignore = ['index.json', 'rindex.json', 'meta.json'];

        let files = fs.readdirSync(this.config.database_path);
        let filtered = [];

        for (let file of files) {
            if (ignore.includes(file)) {
                continue;
            }

            if (include_memory_cache_file === false) {
                // skip if the file_prefix cannot be found
                if (!file.includes(self.config.file_prefix)) {
                    continue;
                }
            }

            filtered.push(file);
        }

        const regex = /(\d+)\.json/;

        filtered.sort(function (a, b) {
            let time_a = a.match(regex);
            let time_b = b.match(regex);
            return time_b[1] - time_a[1];
        });

        return filtered;
    }

    /**
     * Detect broken database files and invalid values in meta file.
     * Abort quickly if data is inconsistent.
     */
    _consistency_checks() {
        // check rindex keys are integers from 0 - rindex.length
        if (this.rindex_size() > 0) {
            let rindex_keys = Object.keys(this.rindex).map((key) => parseInt(key));
            let sum = rindex_keys.reduce((a, b) => a + b);
            let sum2 = ((rindex_keys.length - 1) * (rindex_keys.length) / 2);
            if (sum != sum2) {
                this._log(`ConsistencyCheck: Broken rindex (sum=${sum}, sum2=${sum2})`, 'INFO', true);
            } else {
                this._log(`db.js - Reverse Index healthy`);
            }
        }

        if (this.index_size() !== this.rindex_size()) {
            this._log(`ConsistencyCheck: Conflicting index sizes: (index=${this.index_size()}, rindex=${this.rindex_size()})`, 'INFO', true);
        }

        // check that meta.json contains all database files
        let files = this._getFiles(false);

        for (let file of files) {
            if (!this.meta.archive[file]) {
                this._log(`ConsistencyCheck: file ${file} not included in meta.json archive`, 'INFO', true);
            }
        }

        let num_items = 0;
        let all_files = this._getFiles(true);
        for (let file of all_files) {
            let contents = fs.readFileSync(this._path(file)).toString();
            let parsed_data = JSON.parse(contents);
            num_items += parsed_data.length;
        }

        if (this.index_size() !== num_items && num_items !== this.rindex_size()) {
            this._log(`ConsistencyCheck: Conflicting number of items in database (${num_items}): (index=${this.index_size()}, rindex=${this.rindex_size()})`, 'INFO', true);
        }

        // check that meta.json archive size count amounts to index size and rindex size
        let sum = 0;
        for (let key in this.meta.archive) {
            sum += this.meta.archive[key].size;
        }

        if (sum !== (this.index_size() - this.cache_size()) || sum !== (this.rindex_size() - this.cache_size())) {
            this._log(`ConsistencyCheck: meta archive file size does not amount to index/rindex size`
            , 'INFO', true);
        }
    }

    _check_config() {
        // check persist_after_MB
        if (this.config.persist_after_MB <= 0 || this.config.persist_after_MB > 100) {
            this._log('InvalidConfig: persist_after_MB must be in range [0, 100]', 'INFO', true);
        }

        // check persist_after_seconds
        const max_seconds = 100 * 24 * 60 * 60;
        const min_persist_interval = 4;
        if (this.config.persist_after_seconds <= min_persist_interval || this.config.persist_after_seconds > max_seconds) {
            this._log(`InvalidConfig: persist_after_seconds must be in range [0, ${max_seconds}]`, 'INFO', true);
        }

        // check flush_interval
        const min_flush_interval = 3;
        const max_flush_interval = 10 * 60 * 60;
        if (this.config.flush_interval <= min_flush_interval || this.config.flush_interval > max_flush_interval) {
            this._log(`InvalidConfig: flush_interval must be in range [${min_flush_interval}, ${max_flush_interval}]`, 'INFO', true);
        }

        // check max_key_size_bytes
        const min_max_key_size_bytes = 100;
        const max_max_key_size_bytes = 1024 * 64;
        if (this.config.max_key_size_bytes <= min_max_key_size_bytes || this.config.max_key_size_bytes > max_max_key_size_bytes) {
            this._log(`InvalidConfig: max_key_size_bytes must be in range [${min_max_key_size_bytes}, ${max_max_key_size_bytes}]`, 'INFO', true);
        }

        // check max_value_size_bytes
        if (this.config.max_value_size_bytes < 1024 || this.config.max_value_size_bytes > 1048576 * 10) {
            this._log(`InvalidConfig: max_value_size_bytes must be in range [1024, ${1048576 * 10}]`, 'INFO', true);
        }

        // check file_prefix
        if (this.config.file_prefix.length <= 0 || !this.config.file_prefix.includes('_')) {
            this._log('InvalidConfig: file_prefix must include a `_`', 'INFO', true);
        }
    }

    _load_meta() {
        const meta_path = this._path('meta.json');
        if (fs.existsSync(meta_path)) {
            let contents = fs.readFileSync(meta_path).toString();
            return JSON.parse(contents);
        } else {
            return {
                archive: {},
            };
        }
    }

    _load_index(name='index.json') {
        const index_path = this._path(name);
        if (fs.existsSync(index_path)) {
            let contents = fs.readFileSync(index_path).toString();
            return JSON.parse(contents);
        } else {
            return {};
        }
    }
}

exports.DBjs = DBjs;