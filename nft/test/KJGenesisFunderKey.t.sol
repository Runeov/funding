// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { KJGenesisFunderKey } from "../contracts/KJGenesisFunderKey.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
}

contract KJGenesisFunderKeyTest {
    Vm private constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address payable private constant TREASURY = payable(address(0xBEEF));
    address private constant FOUNDER = address(0xF01);
    address private constant OTHER = address(0x0B0B);
    uint256 private constant MINT_PRICE = 0.05 ether;
    bytes32 private constant ARTWORK_HASH =
        0x5a1fc50ecc9ea926297e38824f1b86ae21b97910711d5a2664ab5fb7264cd331;

    function testDeploymentHasImmutable150KeyBoundary() public {
        KJGenesisFunderKey key = _deploy(1);

        _assertEq(key.name(), "KJ Genesis Funder Key");
        _assertEq(key.symbol(), "KJFG");
        _assertEq(key.MAX_SUPPLY(), 150);
        _assertEq(key.totalSupply(), 0);
        _assertEq(key.remainingSupply(), 150);
        _assertEq(key.treasury(), TREASURY);
        _assertEq(key.artProvenanceHash(), ARTWORK_HASH);
    }

    function testDeploymentRejectsZeroMintPrice() public {
        vm.expectRevert(KJGenesisFunderKey.InvalidMintPrice.selector);
        new KJGenesisFunderKey(
            OWNER,
            TREASURY,
            0,
            1,
            0,
            "ipfs://unrevealed/metadata.json",
            "ipfs://unrevealed/collection.json",
            ARTWORK_HASH
        );
    }

    function testAllowlistRequiresProofAllocationAndExactPrice() public {
        KJGenesisFunderKey key = _deploy(1);
        uint256 allocation = 1;
        bytes32 root = _allowlistLeaf(FOUNDER, allocation);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(OWNER);
        key.setAllowlistRoot(root);
        vm.prank(OWNER);
        key.setSalePhase(KJGenesisFunderKey.SalePhase.Allowlist);

        vm.deal(OTHER, MINT_PRICE);
        vm.prank(OTHER);
        vm.expectRevert(KJGenesisFunderKey.AllowlistProofInvalid.selector);
        key.allowlistMint{ value: MINT_PRICE }(1, allocation, proof);

        vm.deal(FOUNDER, MINT_PRICE);
        vm.prank(FOUNDER);
        vm.expectRevert(
            abi.encodeWithSelector(
                KJGenesisFunderKey.IncorrectPayment.selector, MINT_PRICE, MINT_PRICE - 1
            )
        );
        key.allowlistMint{ value: MINT_PRICE - 1 }(1, allocation, proof);

        vm.prank(FOUNDER);
        key.allowlistMint{ value: MINT_PRICE }(1, allocation, proof);

        _assertEq(key.ownerOf(1), FOUNDER);
        _assertTrue(key.isFunder(FOUNDER));

        vm.deal(FOUNDER, MINT_PRICE);
        vm.prank(FOUNDER);
        vm.expectRevert(
            abi.encodeWithSelector(
                KJGenesisFunderKey.AllowlistAllocationExceeded.selector, 2, 1
            )
        );
        key.allowlistMint{ value: MINT_PRICE }(1, allocation, proof);
    }

    function testPublicMintEnforcesPerWalletLimit() public {
        KJGenesisFunderKey key = _deploy(1);
        vm.prank(OWNER);
        key.setSalePhase(KJGenesisFunderKey.SalePhase.Public);

        vm.deal(FOUNDER, MINT_PRICE * 2);
        vm.prank(FOUNDER);
        key.publicMint{ value: MINT_PRICE }(1);

        vm.prank(FOUNDER);
        vm.expectRevert(
            abi.encodeWithSelector(
                KJGenesisFunderKey.PerWalletLimitExceeded.selector, 2, 1
            )
        );
        key.publicMint{ value: MINT_PRICE }(1);
    }

    function testCannotAllocateToken151() public {
        KJGenesisFunderKey key = _deploy(150);
        address[] memory firstBatch = new address[](75);
        address[] memory secondBatch = new address[](75);
        address[] memory finalKey = new address[](1);

        for (uint256 i = 0; i < 75; ++i) {
            firstBatch[i] = FOUNDER;
            secondBatch[i] = FOUNDER;
        }
        finalKey[0] = FOUNDER;

        vm.prank(OWNER);
        key.allocate(firstBatch);
        vm.prank(OWNER);
        key.allocate(secondBatch);

        _assertEq(key.totalSupply(), 150);
        _assertEq(key.remainingSupply(), 0);

        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(KJGenesisFunderKey.SupplyExceeded.selector, 151, 150)
        );
        key.allocate(finalKey);
    }

    function testRevealThenPermanentMetadataFreeze() public {
        KJGenesisFunderKey key = _deploy(1);
        address[] memory recipients = new address[](1);
        recipients[0] = FOUNDER;

        vm.prank(OWNER);
        key.allocate(recipients);
        _assertEq(key.tokenURI(1), "ipfs://unrevealed/metadata.json");

        vm.prank(OWNER);
        key.reveal("ipfs://token-metadata/", "ipfs://collection/collection.json");
        _assertEq(key.tokenURI(1), "ipfs://token-metadata/1.json");

        vm.prank(OWNER);
        key.freezeMetadata();
        _assertTrue(key.metadataFrozen());

        vm.prank(OWNER);
        vm.expectRevert(KJGenesisFunderKey.MetadataAlreadyFrozen.selector);
        key.reveal("ipfs://changed/", "ipfs://changed/collection.json");
    }

    function testPauseBlocksMintingAndTransfers() public {
        KJGenesisFunderKey key = _deploy(1);
        address[] memory recipients = new address[](1);
        recipients[0] = FOUNDER;

        vm.prank(OWNER);
        key.allocate(recipients);
        vm.prank(OWNER);
        key.pause();

        vm.prank(FOUNDER);
        vm.expectRevert();
        key.transferFrom(FOUNDER, OTHER, 1);

        recipients[0] = OTHER;
        vm.prank(OWNER);
        vm.expectRevert();
        key.allocate(recipients);
    }

    function testWithdrawRoutesOnlyToImmutableTreasury() public {
        KJGenesisFunderKey key = _deploy(1);
        vm.prank(OWNER);
        key.setSalePhase(KJGenesisFunderKey.SalePhase.Public);

        vm.deal(FOUNDER, MINT_PRICE);
        vm.prank(FOUNDER);
        key.publicMint{ value: MINT_PRICE }(1);

        uint256 beforeBalance = TREASURY.balance;
        vm.prank(OTHER);
        key.withdraw();

        _assertEq(TREASURY.balance - beforeBalance, MINT_PRICE);
        _assertEq(address(key).balance, 0);
    }

    function _deploy(uint256 perWallet) private returns (KJGenesisFunderKey) {
        return new KJGenesisFunderKey(
            OWNER,
            TREASURY,
            MINT_PRICE,
            perWallet,
            0,
            "ipfs://unrevealed/metadata.json",
            "ipfs://unrevealed/collection.json",
            ARTWORK_HASH
        );
    }

    function _allowlistLeaf(address account, uint256 allocation)
        private
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(account, allocation))));
    }

    function _assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint assertion failed");
    }

    function _assertEq(address actual, address expected) private pure {
        require(actual == expected, "address assertion failed");
    }

    function _assertEq(bytes32 actual, bytes32 expected) private pure {
        require(actual == expected, "bytes32 assertion failed");
    }

    function _assertEq(string memory actual, string memory expected) private pure {
        require(
            keccak256(bytes(actual)) == keccak256(bytes(expected)),
            "string assertion failed"
        );
    }

    function _assertTrue(bool value) private pure {
        require(value, "bool assertion failed");
    }
}
