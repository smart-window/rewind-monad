// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title RewindEscrow
/// @notice Adds a short, cancellable safety window to native MON transfers.
/// @dev Funds are held by this contract until the selected release time.
contract RewindEscrow {
    uint64 public constant MIN_DELAY = 30 seconds;
    uint64 public constant MAX_DELAY = 30 days;

    enum Status {
        Pending,
        Released,
        Cancelled
    }

    struct Transfer {
        address sender;
        address recipient;
        uint256 amount;
        uint64 releaseAt;
        Status status;
    }

    error ZeroAddress();
    error ZeroAmount();
    error SelfTransfer();
    error InvalidDelay();
    error TransferNotFound();
    error NotSender();
    error NotPending();
    error SafetyWindowClosed();
    error SafetyWindowOpen();
    error PayoutFailed();
    error DirectPaymentDisabled();
    error ReentrantCall();

    event TransferCreated(
        uint256 indexed transferId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint64 releaseAt
    );
    event TransferCancelled(uint256 indexed transferId, address indexed sender);
    event TransferReleased(uint256 indexed transferId, address indexed recipient);

    uint256 public nextTransferId = 1;
    mapping(uint256 transferId => Transfer transferData) private transfers;
    bool private entered;

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    /// @notice Create a delayed transfer funded with native MON.
    function createTransfer(address recipient, uint64 delaySeconds)
        external
        payable
        returns (uint256 transferId)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == msg.sender) revert SelfTransfer();
        if (msg.value == 0) revert ZeroAmount();
        if (delaySeconds < MIN_DELAY || delaySeconds > MAX_DELAY) revert InvalidDelay();

        transferId = nextTransferId++;
        uint64 releaseAt = uint64(block.timestamp) + delaySeconds;
        transfers[transferId] = Transfer({
            sender: msg.sender,
            recipient: recipient,
            amount: msg.value,
            releaseAt: releaseAt,
            status: Status.Pending
        });

        emit TransferCreated(transferId, msg.sender, recipient, msg.value, releaseAt);
    }

    /// @notice Cancel during the safety window and return the escrowed MON.
    function cancelTransfer(uint256 transferId) external nonReentrant {
        Transfer storage transferData = _existingTransfer(transferId);
        if (msg.sender != transferData.sender) revert NotSender();
        if (transferData.status != Status.Pending) revert NotPending();
        if (block.timestamp >= transferData.releaseAt) revert SafetyWindowClosed();

        transferData.status = Status.Cancelled;
        (bool success,) = payable(transferData.sender).call{value: transferData.amount}("");
        if (!success) revert PayoutFailed();

        emit TransferCancelled(transferId, transferData.sender);
    }

    /// @notice Release a matured transfer. Anyone may trigger settlement.
    function releaseTransfer(uint256 transferId) external nonReentrant {
        Transfer storage transferData = _existingTransfer(transferId);
        if (transferData.status != Status.Pending) revert NotPending();
        if (block.timestamp < transferData.releaseAt) revert SafetyWindowOpen();

        transferData.status = Status.Released;
        (bool success,) = payable(transferData.recipient).call{value: transferData.amount}("");
        if (!success) revert PayoutFailed();

        emit TransferReleased(transferId, transferData.recipient);
    }

    function getTransfer(uint256 transferId) external view returns (Transfer memory) {
        return _existingTransfer(transferId);
    }

    function _existingTransfer(uint256 transferId) private view returns (Transfer storage transferData) {
        transferData = transfers[transferId];
        if (transferData.sender == address(0)) revert TransferNotFound();
    }

    receive() external payable {
        revert DirectPaymentDisabled();
    }
}
