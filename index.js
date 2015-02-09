var debug = require('debug')('bant:build');
var concat = require('concat-stream');
var through = require('through2');
var inherits = require('util').inherits;
var normalize = require('bant-normalize');
var Duplex = require('readable-stream/duplex');
var Readable = require('readable-stream/readable');
var browserify = require('browserify');
var factor = require('factor-bundle');
var path = require('path');
var extend = require('util')._extend;


module.exports = build;
inherits(build, Duplex);

function build (b, opts) {
  if (!b || (b && 'function' !== typeof b.bundle)) {
    opts = b;
    b = browserify();
  }

  if (!(this instanceof build)) return new build(b, opts);

  Duplex.call(this, { objectMode: true });

  if (!opts) opts = {};

  var self = this,
      rows = [],
      watch = ('function' === typeof b.close);
      globals = opts.globals || {};

  this._piping = false;
  this._b = b;

  (this._normalize = normalize(opts))
    .on('data', function (row) { rows.push(row); })

    .once('end', function () {

      var g = extend({}, globals),
          outputs = [];

      rows.forEach(function (row) {
        if (row.name) {
          var src = '';
          if ('object' === typeof row.globals) {
            src += "var globals = require('globals');\n";
            Object.keys(row.globals).forEach(function (key) {
              src += "globals['" + key + "'] = "
                  + JSON.stringify(row.globals[key]) + ";\n";
            });
          }

          // XXX: dedupe fail
          //src += "module.exports=require('./" + path.basename(row.main.file) + "');\n";

          src += "module.exports=require('" + row.main.file + "');\n";

          b.require(read(src), {
            entry: true,
            expose: row.main.expose,
            basedir: path.dirname(row.main.file)
          }).exclude(row.main.expose);

          if (!watch)
            outputs.push(self._packup(row.name));
          else {
            outputs.push(function () {
              return self._packup(row.name);
            });
          }
        }
      });

      g = 'var g = ' + JSON.stringify(g) + ';\nmodule.exports = g;';

      b.require(read(g), { 
        entry: true,
        expose: 'globals'
      }).exclude('globals').plugin(factor, { outputs: outputs });

      var s = null;
      if (!watch) {
        s = b.bundle(function (err, src) {
          if (err) throw err;
        }).pipe(self._packup());
      } else {
        b.on('update', function (ids) {
          debug('updated ', ids);
          self._wbundle();
        });
        s = self._wbundle().pipe(function () {
          return self._packup();
        }());
      }
    });

  this.once('finish', function () { self._normalize.end(); });
}

build.prototype.pipe = function () {
  this._buf = [];
  this._piping = true;
  return Duplex.prototype.pipe.apply(this, arguments);
};

build.prototype._read = function (n) { 
  var row, self = this, read = 0;
  while ((row = self._buf.shift()) != null) { self.push(row); read++; }
  if (read === 0) {
    self.once('_drainbuf', function (fin) { 
      self._read(n); 
      if (fin) self.push(null);
    });
  }
};

build.prototype._write = function (row, enc, cb) {
  return this._normalize._write(row, enc, cb);
};

build.prototype._packup = function (name) {
  var self = this;

  return concat(function (source) {
    var data = { name: name || 'common', source: source };

    self.emit('bundle', data);

    if (self._piping) {
      self._buf.push(data);
      self.emit('_drainbuf', !name);
    } 
  });
};

build.prototype._wbundle = function () {
  var b = this._b, self = this;
  var wb = b.bundle(function (err, src) {
    if (err) return debug('werror', err);
    var data = { name: 'common', source: src };
    self.emit('bundle', data);
  });
  return wb;
};

function isStream (s) { return s && typeof s.pipe === 'function'; }

function read (src) {
  var s = Readable();
  s._read = function () {
    s.push(src);
    s.push(null);
  };
  return s;
}

