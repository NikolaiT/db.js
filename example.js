const express = require('express')
const DBjs = require('./dbjs').DBjs

const config = {
  // absolute/relative path to database directory
  database_path: '/tmp/exampleDatabase/',
  // path to file where to log debug outputs to
  logfile_path: '/tmp/example.log',
  // whether to print debug output
  debug: true,
};

let db_js = new DBjs(config);

const app = express()
const port = 3000

function randomString(length = 100) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(Math.floor(65 + Math.random() * 25));
  }
  return str;
}

// Setting keys: http://localhost:3000/set?key=alpha&value=beta
// Getting value for a key: http://localhost:3000/get?key=alpha

app.all('/set', (req, res) => {
  res.header('Content-Type', 'application/json');

  if (req.query.key === undefined) {
    return res.status(400).send({ msg: 'you must provide a key' })
  }

  let key = req.query.key;
  let value = undefined;

  if (req.query.value) {
    value = req.query.value
  }

  if (req.body && req.body.value) {
    value = req.body.value;
  }

  if (value === undefined) {
    return res.status(400).send({ msg: 'you must provide a value' })
  }

  db_js.set(key, value);

  return res.status(200).send({ msg: 'ok' })
})

app.get('/get', (req, res) => {
  res.header('Content-Type', 'application/json');

  if (req.query.key === undefined) {
    return res.status(400).send({ msg: 'you must provide a key' })
  }

  let key = req.query.key;

  return res.status(200).send(db_js.get(key))
})

app.get('/get_all', (req, res) => {
  res.header('Content-Type', 'application/json');
  return res.status(200).send(JSON.stringify(db_js._getn(100000), null, 2))
})

app.get('/insert_random', (req, res) => {
  res.header('Content-Type', 'application/json');

  if (req.query.num === undefined) {
    return res.status(400).send({ msg: 'you must provide the number of random values to insert with the key `num`' })
  }

  let num = parseInt(req.query.num);

  for (let i = 0; i < num; i++) {
    db_js.set(randomString(5), randomString(30));
  }

  return res.status(200).send({ msg: 'ok' })
})

app.listen(port, () => {
  console.log(`Example db.js app listening on port ${port}`)
})