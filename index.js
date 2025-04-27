const express = require('express');
const path = require("path");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const session = require("express-session");
const flash = require("connect-flash");
const methodOverride = require('method-override');
const {isAdminLoggedIn, alreadyLoggedIn} = require("./middleware/auth");
const { render } = require('ejs');
const port = 8080;
const app = express();
const { sendReservationNotification, movedToReservation, reminderEmail, expiredReservationEmail, dueReminderEmail, sendOverdueEmail } = require("./mailer");
const cron = require("node-cron");

app.set("view engine", "ejs");
app.use(express.static("public"))
app.set("views", path.join(__dirname, "/views"));
app.set("public", path.join(__dirname, "/public"));
app.use(express.urlencoded({extended:true}));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));
app.use(flash());
app.use((req, res, next) => {   
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});
app.use(methodOverride("_method"));

const connection = mysql.createConnection({
    host: "localhost",
    user: "root", 
    database: process.env.DATABASE_NAME,
    password: process.env.DATABASE_PASSWORD
});

app.listen(port, () => (
    console.log('App is running!')
));

//Cron job for setting status = expired for un-collected reservations
cron.schedule("0 * * * *", () => {
    console.log("⏰ Running auto-delete for expired reservations...");

    const fetchExpired = `
        SELECT * FROM reservations
        WHERE notified = true
        AND return_status = 'pending'
        AND collected = false
        AND reserved_at < (NOW() - INTERVAL 1 MINUTE)
    `;

    connection.query(fetchExpired, (err, expiredRows) => {
        if (err) return console.error("Error fetching expired reservations:", err);
        if (expiredRows.length === 0) return console.log("✅ No expired reservations to delete.");

        expiredRows.forEach((reservation) => {
            const { id, book_id } = reservation;

            // Step 1: Mark reservation as 'Expired'
            const updateStatus = `UPDATE reservations SET return_status = 'Expired' WHERE id = ?`;
            connection.query(updateStatus, [id], (err1) => {
                if (err1) return console.error(`❌ Error updating reservation ${id}:`, err1);
                if (reservation.contact.includes("@")) {
      connection.query(`SELECT book_name FROM tempBooks WHERE id = ?`, [book_id], (err2, rows) => {
           if (err2) return console.error("❌ Error fetching book name:", err2);
          const bookName = rows[0]?.book_name;

           expiredReservationEmail(reservation.contact, bookName)
               .then(() => console.log(`📧 Expiry email sent to ${reservation.contact}`))
               .catch(err => console.error("❌ Failed to send expiry email:", err));
       });
   }
                 
                // Step 2: Check waitlist
                const getNextWaitlist = `SELECT * FROM waitlist WHERE book_id = ? ORDER BY joined_at ASC LIMIT 1`;
                connection.query(getNextWaitlist, [book_id], (err2, waitlist) => {
                    if (err2) return console.error("Error checking waitlist:", err2);
                    if (waitlist.length === 0) {
                        // No one on waitlist → set book as Available
                        const setAvailable = `UPDATE tempBooks SET status = 'Available' WHERE id = ?`;
                        connection.query(setAvailable, [book_id], (err3) => {
                            if (err3) console.error("❌ Failed to mark book as available:", err3);
                        });
                    } else {
                        const nextUser = waitlist[0];
                        const moveToReservations = `
                            INSERT INTO reservations (book_id, name, contact)
                            VALUES (?, ?, ?)
                        `;
                        connection.query(moveToReservations, [book_id, nextUser.name, nextUser.contact], (err4) => {
                            if (err4) return console.error("❌ Failed to promote from waitlist:", err4);

                            // Remove from waitlist
                            const removeFromWaitlist = `DELETE FROM waitlist WHERE id = ?`;
                            connection.query(removeFromWaitlist, [nextUser.id], (err5) => {
                                if (err5) return console.error("❌ Failed to remove user from waitlist:", err5);

                                // Optionally send notification
                                connection.query(`SELECT book_name FROM tempBooks WHERE id = ?`, [book_id], (err6, bookRows) => {
                                    if (err6) return console.error("❌ Failed to fetch book name:", err6);

                                    const bookName = bookRows[0]?.book_name;
                                    if (nextUser.contact.includes("@")) {
                                        const { movedToReservation } = require("./mailer"); // update to your path
                                        movedToReservation(nextUser.contact, bookName)
                                            .then(() => {
                                                const notifyUpdate = `UPDATE reservations SET notified = true WHERE book_id = ? AND name = ?`;
                                                connection.query(notifyUpdate, [book_id, nextUser.name]);
                                                console.log(`📧 Email sent to ${nextUser.contact}`);
                                            })
                                            .catch(err => {
                                                console.error("❌ Failed to send email:", err);
                                            });
                                    }
                                });
                            });
                        });
                    }
                });
            });
        });
    });
});

//Cron job to send reminder before reservation expiry
cron.schedule("0 */1 * * *", () => {
    console.log("⏰ Checking for reservations due for reminder...");
    const reminderQuery = `
        SELECT * FROM reservations
        WHERE notified = true
        AND collected = false
        AND return_status = 'Pending'
        AND reminder_sent = false
        AND TIMESTAMPDIFF(HOUR, reserved_at, NOW()) >= 22
        AND TIMESTAMPDIFF(HOUR, reserved_at, NOW()) < 23
    `;
    connection.query(reminderQuery, (err, rows) => {
        if (err) return console.error("Error fetching reminders:", err);
        if (rows.length === 0) return console.log("✅ No reminders to send.");
        rows.forEach((row) => {
            const { id, contact, book_id } = row;
            connection.query("SELECT book_name FROM tempBooks WHERE id = ?", [book_id], (err2, result) => {
                if (err2) return console.error("❌ Failed to get book name:", err2);
                const bookName = result[0].book_name;

                if (contact.includes("@")) {
                    reminderEmail(contact, bookName)
                        .then(() => {
                            console.log(`📧 Reminder email sent to ${contact}`);
                            connection.query("UPDATE reservations SET reminder_sent = true WHERE id = ?", [id], (err3) => {
                                    if (err3) console.error("❌ Failed to mark reminder_sent:", err3);
                                }
                            );
                        })
                        .catch((err) => {
                            console.error("❌ Reminder email failed:", err);
                        });
                }
            });
        });
    });
});


//Cron job to sned remainder 1 day before due date
cron.schedule("0 9 * * *", () => {
    console.log("📆 Checking for due date reminders...");

    const query = `
        SELECT r.id, r.contact, r.book_id, b.book_name
        FROM reservations r
        JOIN tempBooks b ON r.book_id = b.id
        WHERE r.collected = true
        AND r.return_status = 'Pending'
        AND r.reserved_at + INTERVAL 7 DAY <= NOW() + INTERVAL 1 DAY
        AND r.reserved_at + INTERVAL 7 DAY > NOW()
    `;

    connection.query(query, (err, rows) => {
        if (err) return console.error("❌ Error fetching reminders:", err);
        if (rows.length === 0) return console.log("✅ No due date reminders needed now.");
        rows.forEach((row) => {
            if (row.contact.includes("@")) {
                dueReminderEmail(row.contact, row.book_name)
                    .then(() => console.log(`📧 Reminder sent to ${row.contact}`))
                    .catch((err) => console.error("❌ Error sending reminder:", err));
            }
        });
    });
});

function checkAndMarkOverdueReservations() {
    console.log("⏰ Running overdue check for reservations...");

    const query = `
        UPDATE reservations
        SET return_status = 'Overdue'
        WHERE reserved_at < NOW() - INTERVAL 7 DAY
        AND notified = 1
        AND collected = 1
        AND return_status = 'Pending'
        AND return_status != 'Returned'
        AND return_status != 'Overdue'
    `;

    connection.query(query, (err, result) => {
        if (err) {
            console.error("❌ Error marking overdue reservations:", err);
        } else {
            console.log(`✅ Marked ${result.affectedRows} reservations as Overdue.`);
        }
    });
}
// Cron job to run every day at midnight to track overDue reservations
cron.schedule('0 0 * * *', checkAndMarkOverdueReservations);
// checkAndMarkOverdueReservations();

app.get("/", (req, res) => {
    const search = req.query.search; 
    let query = "SELECT * FROM tempBooks";  
    let params = [];  
    if (search) {
        query += " WHERE book_name LIKE ? OR author LIKE ? OR category LIKE ?";
        const term = `%${search}%`; 
        params = [term, term, term];
    }

    connection.query(query, params, (err, results, fields) => {
        if (err) {
            console.error("Error loading books:", err);
            return res.send("An error occurred. Please try again");
        }
        res.render("home.ejs", {results, search})
    });
});

app.get("/admin", alreadyLoggedIn, (req, res) => {
    res.render("adminLogin.ejs");
});

app.post("/admin", (req, res) => {
    // console.log(req.body);
    const {username, password} = req.body;
    connection.query(`SELECT password_hash FROM admins where username=?`, [username], (err, result, fields) => {
    if (err) throw err;
    //error handling mechanism
    if (result.length === 0) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/admin");
    }
    // console.log(result);
    bcrypt.compare(password, result[0].password_hash, (error, success) => {
        if (success) {
            req.session.admin = username;
            req.flash("success", "Logged in successfully!");
            res.redirect("/admin/dashboard");
        } else {
            req.flash("error", "Invalid username or password. Please try again");
            res.redirect("/admin");
        }
    });
    }); 
});

app.get("/admin/dashboard", isAdminLoggedIn, (req, res) => {
    res.render("adminDash.ejs", { admin: req.session.admin });
});

app.get("/admin/logout", isAdminLoggedIn, (req, res) => {
    res.render("confirmLogout.ejs");
})

app.post("/admin/logout", isAdminLoggedIn, (req, res) => {
    req.session.destroy(error => {
        if (error) {
            console.log("Logout error:", error);
            return res.redirect("/admin/dashboard");
        }
        res.redirect("/");
    });
}); 

app.get("/admin/books", isAdminLoggedIn, (req, res) => {
    const search = req.query.search; 
    let query = "SELECT * FROM tempBooks";  
    let params = [];  
    if (search) {
        query += " WHERE book_name LIKE ? OR author LIKE ? OR category LIKE ? OR status like ?";
        const term = `%${search}%`; 
        params = [term, term, term, term];
    }

    connection.query(query, params, (err, books) => {
        if (err) {
            console.error("Error fetching books:", err);
            req.flash("error", "Failed to fetch books.");
            return res.redirect("/admin/dashboard");
        }
        res.render("adminBooks.ejs", { books, search });
    });
});

app.get("/admin/books/new", isAdminLoggedIn, (req, res) => {
    res.render("addBook.ejs");
});

app.post("/admin/books", isAdminLoggedIn, (req, res) => {
    let status = "Available";
    let {bookName, author, category} = req.body;
    let values = [[bookName, author, category, status]];
    console.log(bookName, author, category);
    connection.query(`INSERT INTO tempBooks (book_name, author, category, status) VALUES ?`, [values], (err, result, fields) => {
        if (err) {
            console.log("error occured during insertion: ", err);
            req.flash("error", "Please enter valid books details");
            res.redirect("/admin/books/new");
        }
        req.flash("success", "Book successfully added to the library!");
        res.redirect("/admin/books");
    })
});

app.get("/admin/books/:id", isAdminLoggedIn, (req, res) => {
    let id = req.params.id;
    console.log(id);
    connection.query(`SELECT * FROM tempBooks WHERE id = ?`, [id], (err, book, fields) => {
        if (err) {
            console.log("An error occured during retrieval: ", err);
            req.flash("error", "Retrieval error; please try again");
            res.redirect("/admin/books/");
        }
        res.render("bookUpdate.ejs", {book: book[0]});
    });
});

app.patch("/admin/books/:id", isAdminLoggedIn , (req, res) => {
    let id = req.params.id;
    let {bookName, author, category} = req.body;
    // let values = [[bookName, author, category, id]];
    connection.query(`UPDATE tempBooks SET book_name = ?, author = ?, category = ? WHERE id = ?`, [bookName, author, category, id], (err, success, fields) => {
        if (err) {
            console.log("error occured during updation: ", err);
            req.flash("error", "Updation error; please try again");
            res.redirect(`/admin/books/${id}`);
        }
        req.flash("success", "Book details updated successfully!");
        res.redirect("/admin/books");
    });
});

app.delete("/admin/books/:id", isAdminLoggedIn, (req, res) => {
    let id = req.params.id;
    connection.query(`DELETE from tempBooks where id = ?`, [id], (err1, success, fields) => {
        if (err1) {
            console.log("error occured; book not deleted: ", err1);
            req.flash("error", "Deletion failed; please try again");
            return res.redirect("/admin/books/");
        }

        let query = `UPDATE reservations SET return_status = 'Deleted' WHERE book_id = ? AND return_status = 'Pending'`;
        connection.query(query, [id], (err2, result) => {
            if (err2) {
                console.log("error occured; book not deleted: ", err2);
                req.flash("error", "Updating reservations table failed; please try again");
                return res.redirect("/admin/books/");
            }
            req.flash("success", "Book deleted successfully!");
            res.redirect("/admin/books");
        });
    });
});

app.post("/bookReserve/:id", (req, res) => {
    //use trim() ?
    const id =  req.params.id;
    const {name, contact} = req.body;
    if (!name || !contact) {
        req.flash("error", "Name and contact are required.");
        return res.redirect("/");
    }    
    let query1 = `INSERT INTO reservations (book_id, name, contact) VALUES (?, ?, ?)`;
    connection.query(query1, [id, name, contact], (err1, result1, fields) => {
        if (err1) {
            req.flash("error", "Inserting into reservations table failed. try again");
            return res.redirect("/");
        }

        let query2 = `UPDATE tempBooks SET status = 'Borrowed' WHERE id = ?`;
        connection.query(query2, [id], (err2, result2, fields) => {
            if (err2) {
                req.flash("error", "Updating book in main table failed. Try again");
                return res.redirect("/");
            }
            req.flash("success", `"Book with ID ${id} reserved! We'll notify you via email when it's ready to collect."`)
            res.redirect("/");
        });
    });     
});

app.post("/joinWaitlist/:id", (req, res) => {
    const bookId = req.params.id;
    const { name, contact } = req.body;

    const query = `INSERT INTO waitlist (book_id, name, contact) VALUES (?, ?, ?)`;

    connection.query(query, [bookId, name.trim(), contact.trim()], (err, result) => {
        if (err) {
            console.error("Error adding to waitlist:", err);
            req.flash("error", "Failed to join waitlist. Please try again.");
            return res.redirect("/");
        }
        req.flash("success", `You've been added to the waitlist for Book ID ${bookId}. You'll be notified via email when it's available.`);
        res.redirect("/");
    });
});

app.get("/admin/requests", isAdminLoggedIn, (req, res) => {
    const getReservationsQuery = `
        SELECT r.id, r.name AS user_name, r.contact, r.book_id, b.book_name, b.author, r.reserved_at, r.notified, r.collected, r.return_status
        FROM reservations r
        JOIN tempBooks b ON r.book_id = b.id
        WHERE r.return_status IN ('Pending', 'Overdue')
        ORDER BY r.reserved_at DESC
    `;

    const getWaitlistQuery = `
        SELECT w.id, w.name AS user_name, w.contact, w.book_id, b.book_name, b.author, w.joined_at
        FROM waitlist w
        JOIN tempBooks b ON w.book_id = b.id
        ORDER BY w.joined_at ASC
    `;

    connection.query(getReservationsQuery, (err1, reservations) => {
        if (err1) {
            console.log("Error fetching reservations:", err1);
            return res.render("requests.ejs", { error: "Failed to fetch reservations", reservations: [], waitlist: [] });
        }

        connection.query(getWaitlistQuery, (err2, waitlist) => {
            if (err2) {
                console.log("Error fetching waitlist:", err2);
                return res.render("requests.ejs", { error: "Failed to fetch waitlist", reservations: reservations, waitlist: [] });
            }
            console.log(reservations);
            res.render("requests.ejs", { reservations, waitlist, error: null });
        });
    });
});

app.post("/admin/notify/:id", isAdminLoggedIn, (req, res) => {
    const id = req.params.id;
    const { email, book_name } = req.body;

    if (!email.includes("@")) {
        req.flash("error", "Invalid email address.");
        return res.redirect("/admin/requests");
    }

    sendReservationNotification(email, book_name)
        .then(info => {
            console.log("Email sent:", info.response);
            let query = `UPDATE reservations SET notified = true WHERE id = ?`;
            connection.query(query, [id], (err, results) => {
                if (err) {
                    req.flash("error", "Table couldn't be updated.; please try again");
                    return res.redirect("/admin/requests");
                }
                req.flash("success", `Notification sent to ${email}  `);
                res.redirect("/admin/requests");
            });
        })
        .catch(err => {
            console.error("Error sending email:", err);
            req.flash("error", "Failed to send email. Please try again.");
            res.redirect("/admin/requests");
        });
});

app.post("/admin/deleteReservation/:id", isAdminLoggedIn, (req, res) => {
    const reservationId = req.params.id;
    const { book_id } = req.body;

    //  Step 1: Mark reservation as Returned instead of deleting it
    const markReturned = `
        UPDATE reservations
        SET 
            return_status = CASE 
            WHEN collected = true AND notified = true THEN 'Returned'
            ELSE 'Deleted'
            END,
            returned_at = NOW()
        WHERE id = ?
    `;

    connection.query(markReturned, [reservationId], (err1) => {
        if (err1) {
            req.flash("error", "Failed to update reservation status.");
            return res.redirect("/admin/requests");
        }

        // Step 2: Check if waitlist exists
        const checkWaitlist = `SELECT * FROM waitlist WHERE book_id = ? ORDER BY joined_at ASC LIMIT 1`;
        connection.query(checkWaitlist, [book_id], (err2, waitlistRows) => {
            if (err2) {
                req.flash("error", "Error checking waitlist.");
                return res.redirect("/admin/requests");
            }

            if (waitlistRows.length === 0) {
                // No waitlist → Set book as Available
                const setAvailable = `UPDATE tempBooks SET status = 'Available' WHERE id = ?`;
                connection.query(setAvailable, [book_id], (err3) => {
                    if (err3) {
                        req.flash("error", "Failed to update book status.");
                        return res.redirect("/admin/requests");
                    }
                    req.flash("success", "Reservation deleted. Book marked as available.  ");
                    res.redirect("/admin/requests");
                });
            } else {
                // Waitlist exists → Promote first person
                const nextUser = waitlistRows[0];
                const moveToReservations = `
                    INSERT INTO reservations (book_id, name, contact)
                    VALUES (?, ?, ?)
                `;
                connection.query(moveToReservations, [book_id, nextUser.name, nextUser.contact], (err4) => {
                    if (err4) {
                        req.flash("error", "Failed to promote waitlist user.");
                        return res.redirect("/admin/requests");
                    }
                    let book;
                    connection.query(`SELECT book_name from tempBooks where id = ?`, [book_id], (erri, resx) => {
                        if (erri) {
                            console.log(erri);
                            req.flash("error", "Could not fetch book name from tempBooks;");
                            return res.redirect("/admin/requests");
                        }
                        if (resx.length === 0) {
                            req.flash("error", "No book found with the given ID.");
                            return res.redirect("/admin/requests");
                        }
                        book = resx[0].book_name;
                        if (nextUser.contact.includes("@")) {
                            console.log("Book name: ",book);
                            movedToReservation(nextUser.contact, book)
                                .then(() => {
                                    console.log(`Email sent to ${nextUser.contact}`);
                                    let query = `UPDATE reservations SET notified = true WHERE name = ? AND book_id = ?`;
                                    connection.query(query, [nextUser.name, book_id], (errx, results) => {
                                        if (errx) {
                                            req.flash("error", "Failed to update notification status.");
                                            return res.redirect("/admin/requests");
                                        }
                                        // req.flash("success", `Notification    sent to ${email}`);
                                        // res.redirect("/admin/requests");
                                    });
                                    const removeFromWaitlist = `DELETE FROM waitlist WHERE id = ?`;
                                    connection.query(removeFromWaitlist, [nextUser.id], (err6) => {
                                        if (err6) {
                                            req.flash("error", "User promoted, but not removed from waitlist.  ");
                                            return res.redirect("/admin/requests");
                                        }
    
                                        req.flash("success", `${nextUser.name} is now next in line. Previous reservation marked as returned.  `);
                                        res.redirect("/admin/requests");
                            
                                    });
                                })
                                .catch(err => {
                                    console.error("Email failed:", err);
                                    req.flash("error", "Failed to send email. Please try again.");
                                    return res.redirect("/admin/requests");
                                });
                        } else {
                            const removeFromWaitlist = `DELETE FROM waitlist WHERE id = ?`;
                            connection.query(removeFromWaitlist, [nextUser.id], (err6) => {
                                if (err6) {
                                    req.flash("error", "User promoted, but not removed from waitlist.");
                                    return res.redirect("/admin/requests");
                                }
    
                                req.flash("success", `${nextUser.name} is now next in line. Previous reservation marked as returned.  `);
                                res.redirect("/admin/requests");
                            });
                        }
                    });
                });
            }
        });
    });
});

app.post("/admin/markCollected/:id", isAdminLoggedIn, (req, res) => {
    const reservationId = req.params.id;

    // Step 1: Mark reservation as collected
    const markCollected = `UPDATE reservations SET collected = TRUE WHERE id = ?`;
    connection.query(markCollected, [reservationId], (err) => {
        if (err) {
            req.flash("error", "Failed to mark reservation as collected.");
            return res.redirect("/admin/requests");
        }

        // Step 2: Optionally, you can send a success message or redirect
        req.flash("success", "Reservation marked as collected.");
        res.redirect("/admin/requests");
    });
});


app.get("/admin/requests/history", isAdminLoggedIn, (req, res) => {
    const search = req.query.search || "";

    const query = `
        SELECT * FROM reservations 
        WHERE 
            book_id LIKE ? OR 
            name LIKE ? OR 
            contact LIKE ? OR 
            return_status LIKE ? 
            ORDER BY reserved_at DESC
    `;

    const wildcard = `%${search}%`;

    connection.query(query, [wildcard, wildcard, wildcard, wildcard], (err, result) => {
        if (err) {
            req.flash("error", "Failed to retrieve reservation history.");
            return res.redirect("/admin/requests");
        }
        console.log(result);
        res.render("requestsHistory.ejs", { result, search });
    });
});
app.post("/admin/notifyOverdue/:id", isAdminLoggedIn, (req, res) => {
    const { email, user_name, book_name } = req.body;
    if (!email || !user_name || !book_name) {
        req.flash("error", "Missing necessary information to send overdue notification.");
        return res.redirect("/admin/requests");
    }
    const id = req.params.id;

    sendOverdueEmail(email, user_name, book_name)
        .then(() => {
            const updateQuery = `UPDATE reservations SET overdue_notified = TRUE WHERE id = ?`;
            connection.query(updateQuery, [id], (err) => {
                if (err) {
                    console.error("Failed to update overdue_notified:", err);
                    req.flash("error", "Failed to set status of reservtaion to overdue_notified");
                    return res.redirect("/admin/requests");
                }
                req.flash("success", `Overdue notification sent to ${email} for the book "${book_name}".  `);
                res.redirect("/admin/requests");
            });
        })
        .catch(err => {
            console.error("❌ Error sending overdue email:", err);
            req.flash("error", `Error sending notification: ${err}`);
            return res.redirect("/admin/requests");
        });
});