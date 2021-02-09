const os = require('os')
const Foo = require('./Foo')
const Bar = require('./Bar')
const { VrpcAdapter, VrpcAgent } = require('../../../../index')

VrpcAdapter.register(Foo)
VrpcAdapter.register(Bar)

async function main () {
  await new Promise(resolve => setTimeout(resolve, 1000))
  const agent = new VrpcAgent({
    domain: 'test.vrpc',
    agent: os.hostname(),
    broker: 'mqtt://broker:1883',
    version: 3
  })
  await agent.serve()
  await new Promise(resolve => setTimeout(resolve, 1000))
  await agent.end()
}

main().catch(err => console.error(err))
