# Reaper Multi-Strategy Subgraph

## Generate code

Building will require code to first be automatically generated from the templates and put in the generated folder.
These are TypeScript files containing the type definitions.

```
npm run codegen
```


## Building
These commands will adjust the subgraph.yaml file to the configurations specified in the networks.json file.

```
npm run build-optimism
```
```
npm run build-fantom
```

## Authorizing

In order to deploy you must first be authorized to deploy using the access token.
Replace {put token here} with the access token and then run:

```
npm run auth
```

## Deploying

**ONLY USE THESE COMMANDS WHEN DEPLOYING**

These commands will first adjust the subgraph.yaml file to the configurations specified in the networks.json file,
and then deploy the changes to their respective subgraph. If code changes apply to each chain, then each of the below commands
will need to be run in order to apply changes to each subgraph.

```
npm run deploy-optimism
```
```
npm run deploy-fantom
```

## Debugging

The live graph can be queried in the explorer which can be reached at:
https://thegraph.com/hosted-service/subgraph/byte-masons/multi-strategy-vaults-optimism
Change the name at the end for your particular chain (fantom, optimism etc).