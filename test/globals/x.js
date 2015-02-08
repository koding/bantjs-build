var globals = require('globals');
t.ok(globals);
t.notOk(globals.bar);
t.equal(globals.foo, 'bar');