// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMoody {
    function burn(address _owner, uint256 _tokenId, uint256 _amount) external;
}

contract MoodyBurner {
    address public constant MOODY = 0x35ffe9d966E35Bd1B0e79F0d91e438701eA1C644;
    address public constant OWNER_WALLET = 0xaF7B17E7bbF5A21DeB480711959da0830A93199b;
    address public constant ROCKY = 0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50;
    uint256 public constant TOKEN_ID = 70;

    modifier onlyRocky() {
        require(msg.sender == ROCKY, "Only Rocky");
        _;
    }

    function burnAssistants() external onlyRocky {
        IMoody(MOODY).burn(OWNER_WALLET, TOKEN_ID, 1);
        IMoody(MOODY).burn(OWNER_WALLET, TOKEN_ID, 1);
        IMoody(MOODY).burn(OWNER_WALLET, TOKEN_ID, 1);
    }
}
