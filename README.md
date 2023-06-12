# Reaper Multi-Strategy Subgraph

## Commands to Switch Chains
These commands will adjust the subgraph.yaml file to the configurations specified in the networks.json file.

```
npm run build-optimism
```
```
npm run build-fantom
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