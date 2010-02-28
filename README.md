Hub.js is an in-memory minimalistic PubSubHubBub server. It fails at some tests
against the PubSubHubBub test-suite and will forward the whole Atom file it
got, not knowing what got changed (which is pretty bad).

For hacking purposes only, I'd say.

Installation
------------

Grab node-crypto, compile it and put it into the `lib` directory.

Dependencies
------------

* [node-crypto](http://github.com/greut/node-crypto)
* [template.node.js](http://github.com/greut/template.node.js)

TODO
----

* Have some kind of real memory (SuperFeedr is using Redis)
* Parsing Atom files to know what changed
* Conforms to the test-suite
