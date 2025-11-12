"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAuth = verifyAuth;
function verifyAuth(req, _res, next) {
    if (process.env.NODE_ENV !== 'production') {
        req.userId = process.env.DEV_USER_ID ?? 'dev-user-id-123';
        return next();
    }
    return next();
}
//# sourceMappingURL=auth.js.map