var debug = require('debug')('bant:build');
var concat = require('concat-stream');
var through = require('through2');
var inherits = require('util').inherits;
var normalize = require('bant-normalize');
var Duplex = require('readable-stream/duplex');
var splicer = require('labeled-stream-splicer');
var browserify = require('browserify');
var factor = require('factor-bundle');


module.exports = build;
inherits(build, Duplex);

function build (b, opts) {
  if (arguments.length < 2) {
    if ('function' !== typeof b.bundle) {
      opts = b;
      b = browserify(opts._browserify || {});
    }
  }

  if (!(this instanceof build)) return new build(b, opts);
  Duplex.call(this, { objectMode: true });

  if (!opts) opts = {};

  var self = this, rows = [];

  this._buf = [];
  this.pipeline = this._createPipeline();
  this._normalize = normalize(opts);
  this._normalize.pipe(this.pipeline);
  this.once('finish', function () { self._normalize.end(); });

  this.pipeline.on('data', function (row) {
    rows.push(row);
  }).once('end', function () {

    var streams = [], entries = [];

    rows.forEach(function (row) {
      streams.push(self._concat(row.name));
      entries.push(row._entry.file);

      if (row._entry) {
        b.require(row._entry.file, {
          entry: true, expose: row._entry.expose
        });
      }
    });

    b.plugin(factor, { 
      outputs: streams
    }).bundle(function (err, res) {
      if (err) throw err;
    }).pipe(self._concat());
  });

}

build.prototype._read = function (n) { 
  var row, self = this, read = 0;
  while ((row = self._buf.shift()) != null) { self.push(row); read++; }
  if (read === 0) {
    self.once('_drainbuf', function (end) { 
      self._read(n); 
      if (end) self.push(null);
    });
  }
};

build.prototype._write = function (row, enc, cb) {
  return this._normalize._write(row, enc, cb);
};

build.prototype._group = function () {
  var self = this;
  return through.obj(function (row, enc, cb) {
    var files = [], entry;
    row.scripts.forEach(function (obj) {
      var isEntry = obj.entry || false;
      if (isEntry) entry = obj;
      else files.push(obj);
    });
    row._files = files;
    row._entry = entry;
    this.push(row);
    cb();
  });
};

build.prototype._createPipeline = function () {
  var pipeline = splicer.obj([
    'scripts', [ this._group() ],
    'wrap', []
  ]);
  return pipeline;
};

build.prototype._concat = function (name) {
  var self = this;
  return concat(function (buf) {
    self._buf.push({ name: name || 'common', source: buf });
    self.emit('_drainbuf', !name);
  });
};

function isStream (s) { return s && typeof s.pipe === 'function'; }

