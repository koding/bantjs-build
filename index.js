var debug = require('debug')('bant:build');
var concat = require('concat-stream');
var through = require('through2');
var inherits = require('util').inherits;
var normalize = require('bant-normalize');
var flatten = require('bant-flatten');
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

  var self = this;

  if (!(self instanceof build)) return new build(b, opts);

  Duplex.call(self, { objectMode: true });

  if (!opts) opts = {};

  self._piping = false;
  self._b = b;
  self._normalize = normalize(opts);
  self._branches = [];
  self._nodes = [];
  self._globals = opts.globals || {};
  self._watch = ('function' === typeof b.close);

  self._normalize.on('data', function (branch) {
    self._branches.push(branch);
  });

  self._normalize.on('end', function () {
    self._nodes = flatten(self._branches);
    self._end();
  });

  self.once('finish', function () { self._normalize.end(); });
}

build.prototype._wrap = function (branch) {
  var src = '';
  if ('object' === typeof branch.globals) {
    src += "var globals = require('globals');\n";
    Object.keys(branch.globals).forEach(function (key) {
      src += "globals['" + key + "'] = "
          + JSON.stringify(branch.globals[key]) + ";\n";
    });
  }

  // todo: investigate dedupe fail, we don't want to expose fullpaths
  var file = path.join(branch.basedir, branch.main);
  src += "module.exports = require('" + file + "');\n";

  return read(src);
};

build.prototype._wrapGlobals = function () {
  var self = this, 
      src = 'var g = ' 
        + JSON.stringify(self._globals) 
        + ';\nmodule.exports = g;';
  return read(src);
};

build.prototype._end = function () {
  var self = this,
      branches = self._branches,
      nodes = self._nodes,
      b = this._b,
      outputs = [];

  nodes.forEach(function (node) {
    b.exclude(node.expose);
  });

  branches.forEach(function (branch) {
    b.require(self._wrap(branch), {
      entry: true,
      expose: branch.expose,
      basedir: branch.basedir
    });

    if (!self._watch) {
      outputs.push(self._packup(branch.name));
    } else {
      outputs.push(self._packup.bind(self, branch.name));
    }
  });

  b
    .require(self._wrapGlobals(), {
      entry: true,
      expose: 'globals'
    })
    .exclude('globals')
    .plugin(factor, { outputs: outputs });

  if (!self._watch) {
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

};

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

