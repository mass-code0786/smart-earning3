// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDT is ERC20 {
    address public rejectedRecipient;
    constructor() ERC20("Test USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setRejectedRecipient(address recipient) external {
        rejectedRecipient = recipient;
    }

    function _update(address from,address to,uint256 value) internal override {
        require(to != rejectedRecipient, "REJECTED_RECIPIENT");
        super._update(from,to,value);
    }
}
