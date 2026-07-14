// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";

contract MiniUSDT is ERC20, ERC20Pausable, Ownable {
    uint8 private constant DECIMALS = 6;
    constructor()
        ERC20("Mini Tether USD", "mUSDT")
        Ownable(msg.sender)
    {}

    /**
     * USDT uses 6 decimals
     */
    function decimals()
        public
        pure
        override
        returns(uint8)
    {
        return DECIMALS;
    }

    /**
     * Treasury minting
     */
    function mint(
        address to,
        uint256 amount
    )
        external
        onlyOwner
    {
        _mint(to, amount);
    }

    /**
     * Token burning
     */
    function burn(
        uint256 amount
    )
        external
    {
        _burn(msg.sender, amount);
    }

    /**
     * Emergency pause
     */
    function pause()
        external
        onlyOwner
    {
        _pause();
    }

    function unpause()
        external
        onlyOwner
    {
        _unpause();
    }


    function _update(
        address from,
        address to,
        uint256 value
    )
        internal
        override(
            ERC20,
            ERC20Pausable
        )
    {
        super._update(
            from,
            to,
            value
        );
    }
}