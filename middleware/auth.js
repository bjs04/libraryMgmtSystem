function isAdminLoggedIn(req, res, next) {
    if (req.session && req.session.admin) {
        next(); // allow access
    } else {
        res.redirect("/admin"); // redirect if not logged in
    }
}

function alreadyLoggedIn(req, res, next) {
    if (req.session && req.session.admin) {
        return res.redirect("/admin/dashboard"); // Redirect to dashboard if already logged in
    }
    next(); // Otherwise, continue to login page
}

module.exports = {
    isAdminLoggedIn,
    alreadyLoggedIn
};