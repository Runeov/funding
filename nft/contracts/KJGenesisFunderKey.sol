// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC2981 } from "@openzeppelin/contracts/token/common/ERC2981.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    MerkleProof
} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @title KJ Genesis Funder Key
/// @notice A fixed collection of 150 transferable Project KJ founder access keys.
/// @dev Business benefits are enforced by Project KJ services using ERC-721 ownership.
///      This contract does not promise, calculate, or distribute yield or future revenue.
contract KJGenesisFunderKey is
    ERC721,
    ERC2981,
    Ownable2Step,
    Pausable,
    ReentrancyGuard
{
    using Strings for uint256;

    enum SalePhase {
        Closed,
        Allowlist,
        Public
    }

    uint256 public constant MAX_SUPPLY = 150;
    uint96 public constant MAX_SECONDARY_ROYALTY_BPS = 1_000;

    address payable public immutable treasury;
    uint256 public immutable mintPrice;
    uint256 public immutable maxPerWallet;
    bytes32 public immutable artProvenanceHash;

    uint256 private _nextTokenId = 1;
    string private _baseTokenURI;

    string public unrevealedTokenURI;
    string public contractURI;
    bytes32 public allowlistRoot;
    SalePhase public salePhase;
    bool public revealed;
    bool public metadataFrozen;

    mapping(address account => uint256 quantity) public mintedByWallet;

    error AllowlistAllocationExceeded(uint256 requestedTotal, uint256 allocation);
    error AllowlistProofInvalid();
    error AllowlistRootMissing();
    error EmptyMetadataURI();
    error IncorrectPayment(uint256 expected, uint256 received);
    error InvalidAddress();
    error InvalidMaxPerWallet();
    error InvalidMintPrice();
    error MetadataAlreadyFrozen();
    error MetadataNotRevealed();
    error PerWalletLimitExceeded(uint256 requestedTotal, uint256 maximum);
    error RoyaltyTooHigh();
    error SaleNotActive(SalePhase required, SalePhase actual);
    error SupplyExceeded(uint256 requestedTotal, uint256 maximum);
    error WithdrawFailed();
    error ZeroQuantity();

    event AllowlistRootUpdated(bytes32 indexed root);
    event MetadataFrozen(string baseURI, string contractURI);
    event MetadataRevealed(string baseURI, string contractURI);
    event SalePhaseUpdated(SalePhase indexed previousPhase, SalePhase indexed newPhase);
    event TreasuryWithdrawal(address indexed treasury, uint256 amount);
    event UnrevealedURIUpdated(string uri);

    constructor(
        address initialOwner,
        address payable treasury_,
        uint256 mintPrice_,
        uint256 maxPerWallet_,
        uint96 secondaryRoyaltyBps_,
        string memory unrevealedTokenURI_,
        string memory contractURI_,
        bytes32 artProvenanceHash_
    ) ERC721("KJ Genesis Funder Key", "KJFG") Ownable(initialOwner) {
        if (initialOwner == address(0) || treasury_ == address(0)) {
            revert InvalidAddress();
        }
        if (maxPerWallet_ == 0 || maxPerWallet_ > MAX_SUPPLY) {
            revert InvalidMaxPerWallet();
        }
        if (mintPrice_ == 0) {
            revert InvalidMintPrice();
        }
        if (secondaryRoyaltyBps_ > MAX_SECONDARY_ROYALTY_BPS) {
            revert RoyaltyTooHigh();
        }
        if (bytes(unrevealedTokenURI_).length == 0 || bytes(contractURI_).length == 0) {
            revert EmptyMetadataURI();
        }

        treasury = treasury_;
        mintPrice = mintPrice_;
        maxPerWallet = maxPerWallet_;
        unrevealedTokenURI = unrevealedTokenURI_;
        contractURI = contractURI_;
        artProvenanceHash = artProvenanceHash_;

        if (secondaryRoyaltyBps_ > 0) {
            _setDefaultRoyalty(treasury_, secondaryRoyaltyBps_);
        }
    }

    function totalSupply() public view returns (uint256) {
        return _nextTokenId - 1;
    }

    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    function isFunder(address account) external view returns (bool) {
        return balanceOf(account) > 0;
    }

    function allowlistMint(
        uint256 quantity,
        uint256 allocation,
        bytes32[] calldata proof
    ) external payable nonReentrant whenNotPaused {
        if (salePhase != SalePhase.Allowlist) {
            revert SaleNotActive(SalePhase.Allowlist, salePhase);
        }
        if (allowlistRoot == bytes32(0)) {
            revert AllowlistRootMissing();
        }

        bytes32 leaf =
            keccak256(bytes.concat(keccak256(abi.encode(msg.sender, allocation))));
        if (!MerkleProof.verifyCalldata(proof, allowlistRoot, leaf)) {
            revert AllowlistProofInvalid();
        }

        uint256 requestedTotal = mintedByWallet[msg.sender] + quantity;
        if (requestedTotal > allocation) {
            revert AllowlistAllocationExceeded(requestedTotal, allocation);
        }

        _paidMint(msg.sender, quantity);
    }

    function publicMint(uint256 quantity) external payable nonReentrant whenNotPaused {
        if (salePhase != SalePhase.Public) {
            revert SaleNotActive(SalePhase.Public, salePhase);
        }
        _paidMint(msg.sender, quantity);
    }

    /// @notice Allocates keys sold or approved through an off-chain founder agreement.
    /// @dev Each recipient consumes the same immutable per-wallet allowance as a paid mint.
    function allocate(address[] calldata recipients)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        uint256 quantity = recipients.length;
        if (quantity == 0) revert ZeroQuantity();
        _requireAvailable(quantity);

        for (uint256 i = 0; i < quantity; ++i) {
            address recipient = recipients[i];
            if (recipient == address(0)) revert InvalidAddress();

            uint256 requestedTotal = mintedByWallet[recipient] + 1;
            if (requestedTotal > maxPerWallet) {
                revert PerWalletLimitExceeded(requestedTotal, maxPerWallet);
            }

            mintedByWallet[recipient] = requestedTotal;
            _safeMint(recipient, _nextTokenId);
            unchecked {
                ++_nextTokenId;
            }
        }
    }

    function setAllowlistRoot(bytes32 root) external onlyOwner {
        if (root == bytes32(0)) revert AllowlistRootMissing();
        allowlistRoot = root;
        emit AllowlistRootUpdated(root);
    }

    function setSalePhase(SalePhase newPhase) external onlyOwner {
        SalePhase previousPhase = salePhase;
        salePhase = newPhase;
        emit SalePhaseUpdated(previousPhase, newPhase);
    }

    function setUnrevealedTokenURI(string calldata uri) external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        if (bytes(uri).length == 0) revert EmptyMetadataURI();
        unrevealedTokenURI = uri;
        emit UnrevealedURIUpdated(uri);
    }

    function reveal(string calldata baseURI_, string calldata contractURI_)
        external
        onlyOwner
    {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        if (bytes(baseURI_).length == 0 || bytes(contractURI_).length == 0) {
            revert EmptyMetadataURI();
        }

        _baseTokenURI = baseURI_;
        contractURI = contractURI_;
        revealed = true;
        emit MetadataRevealed(baseURI_, contractURI_);
    }

    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        if (!revealed) revert MetadataNotRevealed();

        metadataFrozen = true;
        emit MetadataFrozen(_baseTokenURI, contractURI);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sends the complete mint balance to the immutable treasury.
    /// @dev Anyone may trigger this; no caller can redirect the funds.
    function withdraw() external nonReentrant {
        uint256 amount = address(this).balance;
        (bool success,) = treasury.call{ value: amount }("");
        if (!success) revert WithdrawFailed();
        emit TreasuryWithdrawal(treasury, amount);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) return unrevealedTokenURI;
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _paidMint(address recipient, uint256 quantity) private {
        if (quantity == 0) revert ZeroQuantity();

        uint256 requestedTotal = mintedByWallet[recipient] + quantity;
        if (requestedTotal > maxPerWallet) {
            revert PerWalletLimitExceeded(requestedTotal, maxPerWallet);
        }

        uint256 expectedPayment = mintPrice * quantity;
        if (msg.value != expectedPayment) {
            revert IncorrectPayment(expectedPayment, msg.value);
        }

        _requireAvailable(quantity);
        mintedByWallet[recipient] = requestedTotal;

        for (uint256 i = 0; i < quantity; ++i) {
            _safeMint(recipient, _nextTokenId);
            unchecked {
                ++_nextTokenId;
            }
        }
    }

    function _requireAvailable(uint256 quantity) private view {
        uint256 requestedTotal = totalSupply() + quantity;
        if (requestedTotal > MAX_SUPPLY) {
            revert SupplyExceeded(requestedTotal, MAX_SUPPLY);
        }
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
}
