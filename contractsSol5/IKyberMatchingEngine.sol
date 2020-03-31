
pragma  solidity 0.5.11;

import "./IKyberReserve.sol";
import "./IKyberNetwork.sol";


interface IKyberMatchingEngine {

    enum ReserveType {
        NONE,
        FPR,
        APR,
        BRIDGE,
        UTILITY,
        CUSTOM,
        ORDERBOOK,
        LAST
    }

    function negligibleRateDiffBps() external view returns (uint);

    function setNegligbleRateDiffBps(uint _negligibleRateDiffBps) external returns (bool);

    function addReserve(address reserve, bytes8 reserveId, ReserveType resType) external returns (bool);

    function removeReserve(address reserve) external returns (bytes8);

    function listPairForReserve(IKyberReserve reserve, IERC20 token, bool ethToToken, bool tokenToEth, bool add)
        external
        returns (bool);

    function getReserveDetails(address reserve) external view
        returns(bytes8 reserveId, ReserveType resType, bool isFeePaying);

    function getReservesPerTokenSrc(IERC20 token) external view returns(bytes8[] memory reserves);
    function getReservesPerTokenDest(IERC20 token) external view returns(bytes8[] memory reserves);

    function getReserveList(
        IERC20 src,
        IERC20 dest,
        uint srcAmount,
        uint networkFeeValue, // bps for t2e, value in wei for e2t
        bool isTokenToToken,
        bytes calldata hint
    )
        external view
        returns(
            bytes8[] memory reserveIds,
            uint[] memory splitValuesBps,
            bool[] memory isFeeAccounted
        );
}
