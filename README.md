# VRPC - Variadic Remote Procedure Calls

[![Build Status](https://travis-ci.com/heisenware/vrpc.svg?branch=master)](https://travis-ci.com/heisenware/vrpc)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/heisenware/vrpc/master/LICENSE)
[![Semver](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/spec/v2.0.0.html)
[![GitHub Releases](https://img.shields.io/github/tag/heisenware/vrpc.svg)](https://github.com/heisenware/vrpc/tag)
[![GitHub Issues](https://img.shields.io/github/issues/heisenware/vrpc.svg)](http://github.com/heisenware/vrpc/issues)

---
## Visit our website: https://vrpc.io
---

## What is VRPC?

VRPC - Variadic Remote Procedure Calls - is a modern and asynchronous
implementation of the old RPC (remote procedure calls) idea. Basically, it
allows to directly call functions written in any programming language by
functions written in any other (or the same) programming language.

VRPC is modern as existing code can be made remotely callable:

- without having to change it
- without the need to program any binding code or complex
  schemas
- without the need to run a server

VRPC is unique as it supports the full power of the programming language in use,
such as:

- automated memory handling
- language native and custom data type support
- callback mechanisms
- asynchronicity (i.e. event-loop integration)
- exception handling
- object orientation
- lambda and closures support

Depending on the targeted technologies, VRPC ships as a library (static or
dynamic linkage), executable or source package.

## Examples

### Embedding C++ into Node.js

- [Simple C++ to Node.js Binding Example](examples/cpp-node-example1/README.md)
- [Advanced C++ to Node.js Binding Example](examples/cpp-node-example2/README.md)

### Embedding C++ into Python3

- [Simple C++ to Python Binding Example](examples/cpp-python-example1/README.md)
- [Advanced C++ to Python Binding Example](examples/cpp-python-example2/README.md)

### Making existing C++ code remotely callable (agent)

- [Simple C++ Agent Example](examples/cpp-agent-example1/README.md)
- [Advanced C++ Agent Example](examples/cpp-agent-example2/README.md)

### Making existing Node.js code remotely callable (agent)

- [Node.js Agent Example](examples/node-agent-example/README.md)

### Calling code remotely from Node.js (client)

- [Node.js Remote Client Example](examples/node-client-example/README.md)

### Frontend-Backend communication

- [Simple React Todos App](https://github.com/heisenware/react-vrpc/tree/master/examples/vrpc-react-todos-1)
- [Advanced React Todos App](https://github.com/heisenware/react-vrpc/tree/master/examples/vrpc-react-todos-2)

## Reference Documentation

- [RPC Protocol Details](docs/reference/remoteProtocol.md)
- [C++ Binding Syntax](docs/reference/cppBinding.md)
- [C++ Agent](docs/reference/cppAgent.md)
- [Node.js API](docs/reference/nodeJs.md)
