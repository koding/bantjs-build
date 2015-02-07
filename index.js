var debug = require('debug')('bant:build');
var through = require('through2');
var inherits = require('util').inherits;
var normalize = require('bant-normalize');
var Duplex = require('readable-stream/duplex');
var splicer = require('labeled-stream-splicer');
var combine = require('stream-combiner2');


module.exports = build;
inherits(build, Duplex);

function build (opts) {
  if (!(this instanceof build)) return new build(opts);
  Duplex.call(this, { objectMode: true });

  if (!opts) opts = {};

  var self = this;

  this.pipeline = this._createPipeline();
  this._normalize = normalize(opts);

  this._normalize.pipe(this.pipeline);

  this.pipeline.on('data', function (row) {
    self.push(row);
  }).on('end', function () {
    self.push(null);
  });
  
  this.once('finish', function () { self._normalize.end(); });
}

build.prototype._read = function (n) { /* noop */ };

build.prototype._write = function (row, enc, cb) {
  return this._normalize._write(row, enc, cb);
};

build.prototype._globals = function () {
  return through.obj(function (row, enc, cb) {
    row.globals = 1;
    this.push(row);
    cb();
  });
};

build.prototype._createPipeline = function () {
  var pipeline = splicer.obj([
    'globals', [ this._globals() ]
  ]);
  return pipeline;
};

