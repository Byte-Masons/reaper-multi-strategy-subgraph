import { Address } from "@graphprotocol/graph-ts";
import { StrategyAdded } from "../generated/ReaperVaultERC4626/ReaperVaultERC4626";
import { Vault } from "../generated/schema";
import { ReaperVaultERC4626 } from "../generated/templates";

const addStrategyAddresses: Address[] = [
  Address.fromString("0x04C710a1E8a738CDf7cAD3a52Ba77A784C35d8CE"), // super-admin multisig
  Address.fromString("0xe1610bB38Ce95254dD77cbC82F9c1148569B560e"), // goober
  Address.fromString("0x950b0E7FD95a08C9525bC82AaE0A8121cC84143E"), // zokunei
  Address.fromString("0x6539519E69343535a2aF6583D9BAE3AD74c6A293"), // degenicus
  Address.fromString("0x1E71AEE6081f62053123140aacC7a06021D77348"), // bongo
  Address.fromString("0xe00691e65cd4400c84a174a4c56f20ba43dffd89"), // ethos deployer
  Address.fromString("0x4c3490df15edfa178333445ce568ec6d99b5d71c"), // eidolon
  Address.fromString("0xF29dA3595351dBFd0D647857C46F8D63Fc2e68C5"), // kamil
  // ... add other addresses that may call addStrategy on a new or existing vault 
];

export function handleStrategyAdded(event: StrategyAdded): void {
  // Ignore event if TX was not from a registered address
  const sender = event.transaction.from;
  if (!addStrategyAddresses.includes(sender)) {
    return;
  }

  // If vault entity does not exist, create new data source for vault. The new data
  // source will also process the calls and events for the block in which it was created.
  //
  // If vault entity already exists, it means that the vault data source must also exist.
  // In that case, we don't do anything here since the vault data source would trigger its own
  // event handlers.
  const vaultAddress = event.address.toHexString();
  const vaultEntity = Vault.load(vaultAddress);
  if (vaultEntity == null) {
    ReaperVaultERC4626.create(event.address);
  }
}
