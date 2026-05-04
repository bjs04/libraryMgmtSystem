const express = require('express');
const path = require("path");
const mysql = require("mysql2");
const mysqlPromise = require('mysql2/promise');
const bcrypt = require("bcryptjs");
const session = require("express-session");
const flash = require("connect-flash");
const methodOverride = require('method-override');
const {isAdminLoggedIn, alreadyLoggedIn} = require("./middleware/auth");
const app = express();
const { sendReservationNotification, movedToReservation, reminderEmail, expiredReservationEmail, dueReminderEmail, sendOverdueEmail } = require("./mailer");
const cron = require("node-cron");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

app.set("view engine", "ejs");
app.use(express.static("public"))
app.set("views", path.join(__dirname, "/views"));
app.set("public", path.join(__dirname, "/public"));
app.use(express.urlencoded({extended:true}));
app.use(express.json({ limit: '50mb' }));
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

const pool = mysqlPromise.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false // REQUIRED for Aiven SSL connection
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 25060,
    ssl: {
        rejectUnauthorized: false // REQUIRED for Aiven SSL connection
    }
});

app.listen(process.env.PORT || 8080, () => {
    console.log('App is running!')
});

// //Cron job for setting status = expired for un-collected reservations
// cron.schedule("0 * * * *", () => {
//     console.log("⏰ Running auto-delete for expired reservations...");

//     const fetchExpired = `
//         SELECT * FROM reservations
//         WHERE notified = true
//         AND return_status = 'pending'
//         AND collected = false
//         AND reserved_at < (NOW() - INTERVAL 1 MINUTE)
//     `;

//     connection.query(fetchExpired, (err, expiredRows) => {
//         if (err) return console.error("Error fetching expired reservations:", err);
//         if (expiredRows.length === 0) return console.log("✅ No expired reservations to delete.");

//         expiredRows.forEach((reservation) => {
//             const { id, book_id } = reservation;

//             // Step 1: Mark reservation as 'Expired'
//             const updateStatus = `UPDATE reservations SET return_status = 'Expired' WHERE id = ?`;
//             connection.query(updateStatus, [id], (err1) => {
//                 if (err1) return console.error(`❌ Error updating reservation ${id}:`, err1);
//                 if (reservation.contact.includes("@")) {
//       connection.query(`SELECT book_name FROM tempBooks WHERE id = ?`, [book_id], (err2, rows) => {
//            if (err2) return console.error("❌ Error fetching book name:", err2);
//           const bookName = rows[0]?.book_name;

//            expiredReservationEmail(reservation.contact, bookName)
//                .then(() => console.log(`📧 Expiry email sent to ${reservation.contact}`))
//                .catch(err => console.error("❌ Failed to send expiry email:", err));
//        });
//    }
                 
//                 // Step 2: Check waitlist
//                 const getNextWaitlist = `SELECT * FROM waitlist WHERE book_id = ? ORDER BY joined_at ASC LIMIT 1`;
//                 connection.query(getNextWaitlist, [book_id], (err2, waitlist) => {
//                     if (err2) return console.error("Error checking waitlist:", err2);
//                     if (waitlist.length === 0) {
//                         // No one on waitlist → set book as Available
//                         const setAvailable = `UPDATE tempBooks SET status = 'Available' WHERE id = ?`;
//                         connection.query(setAvailable, [book_id], (err3) => {
//                             if (err3) console.error("❌ Failed to mark book as available:", err3);
//                         });
//                     } else {
//                         const nextUser = waitlist[0];
//                         const moveToReservations = `
//                             INSERT INTO reservations (book_id, name, contact)
//                             VALUES (?, ?, ?)
//                         `;
//                         connection.query(moveToReservations, [book_id, nextUser.name, nextUser.contact], (err4) => {
//                             if (err4) return console.error("❌ Failed to promote from waitlist:", err4);

//                             // Remove from waitlist
//                             const removeFromWaitlist = `DELETE FROM waitlist WHERE id = ?`;
//                             connection.query(removeFromWaitlist, [nextUser.id], (err5) => {
//                                 if (err5) return console.error("❌ Failed to remove user from waitlist:", err5);

//                                 // Optionally send notification
//                                 connection.query(`SELECT book_name FROM tempBooks WHERE id = ?`, [book_id], (err6, bookRows) => {
//                                     if (err6) return console.error("❌ Failed to fetch book name:", err6);

//                                     const bookName = bookRows[0]?.book_name;
//                                     if (nextUser.contact.includes("@")) {
//                                         const { movedToReservation } = require("./mailer"); // update to your path
//                                         movedToReservation(nextUser.contact, bookName)
//                                             .then(() => {
//                                                 const notifyUpdate = `UPDATE reservations SET notified = true WHERE book_id = ? AND name = ?`;
//                                                 connection.query(notifyUpdate, [book_id, nextUser.name]);
//                                                 console.log(`📧 Email sent to ${nextUser.contact}`);
//                                             })
//                                             .catch(err => {
//                                                 console.error("❌ Failed to send email:", err);
//                                             });
//                                     }
//                                 });
//                             });
//                         });
//                     }
//                 });
//             });
//         });
//     });
// });

// //Cron job to send reminder before reservation expiry
// cron.schedule("0 */1 * * *", () => {
//     console.log("⏰ Checking for reservations due for reminder...");
//     const reminderQuery = `
//         SELECT * FROM reservations
//         WHERE notified = true
//         AND collected = false
//         AND return_status = 'Pending'
//         AND reminder_sent = false
//         AND TIMESTAMPDIFF(HOUR, reserved_at, NOW()) >= 22
//         AND TIMESTAMPDIFF(HOUR, reserved_at, NOW()) < 23
//     `;
//     connection.query(reminderQuery, (err, rows) => {
//         if (err) return console.error("Error fetching reminders:", err);
//         if (rows.length === 0) return console.log("✅ No reminders to send.");
//         rows.forEach((row) => {
//             const { id, contact, book_id } = row;
//             connection.query("SELECT book_name FROM tempBooks WHERE id = ?", [book_id], (err2, result) => {
//                 if (err2) return console.error("❌ Failed to get book name:", err2);
//                 const bookName = result[0].book_name;

//                 if (contact.includes("@")) {
//                     reminderEmail(contact, bookName)
//                         .then(() => {
//                             console.log(`📧 Reminder email sent to ${contact}`);
//                             connection.query("UPDATE reservations SET reminder_sent = true WHERE id = ?", [id], (err3) => {
//                                     if (err3) console.error("❌ Failed to mark reminder_sent:", err3);
//                                 }
//                             );
//                         })
//                         .catch((err) => {
//                             console.error("❌ Reminder email failed:", err);
//                         });
//                 }
//             });
//         });
//     });
// });


// //Cron job to sned remainder 1 day before due date
// cron.schedule("0 9 * * *", () => {
//     console.log("📆 Checking for due date reminders...");

//     const query = `
//         SELECT r.id, r.contact, r.book_id, b.book_name
//         FROM reservations r
//         JOIN tempBooks b ON r.book_id = b.id
//         WHERE r.collected = true
//         AND r.return_status = 'Pending'
//         AND r.reserved_at + INTERVAL 7 DAY <= NOW() + INTERVAL 1 DAY
//         AND r.reserved_at + INTERVAL 7 DAY > NOW()
//     `;

//     connection.query(query, (err, rows) => {
//         if (err) return console.error("❌ Error fetching reminders:", err);
//         if (rows.length === 0) return console.log("✅ No due date reminders needed now.");
//         rows.forEach((row) => {
//             if (row.contact.includes("@")) {
//                 dueReminderEmail(row.contact, row.book_name)
//                     .then(() => console.log(`📧 Reminder sent to ${row.contact}`))
//                     .catch((err) => console.error("❌ Error sending reminder:", err));
//             }
//         });
//     });
// });

// function checkAndMarkOverdueReservations() {
//     console.log("⏰ Running overdue check for reservations...");

//     const query = `
//         UPDATE reservations
//         SET return_status = 'Overdue'
//         WHERE reserved_at < NOW() - INTERVAL 7 DAY
//         AND notified = 1
//         AND collected = 1
//         AND return_status = 'Pending'
//         AND return_status != 'Returned'
//         AND return_status != 'Overdue'
//     `;

//     connection.query(query, (err, result) => {
//         if (err) {
//             console.error("❌ Error marking overdue reservations:", err);
//         } else {
//             console.log(`✅ Marked ${result.affectedRows} reservations as Overdue.`);
//         }
//     });
// }
// // Cron job to run every day at midnight to track overDue reservations
// cron.schedule('0 0 * * *', checkAndMarkOverdueReservations);
// // checkAndMarkOverdueReservations();
// //---------------------------------------------------------------------------------------------------

//homepage route
app.get("/", async (req, res) => {
    const search = req.query.search;
    let query = "SELECT * FROM tempBooks";
    let params = [];

    if (search) {
        query += " WHERE book_name LIKE ? OR author LIKE ? OR category LIKE ?";
        const term = `%${search}%`;
        params = [term, term, term];
    }

    try {
        const [books] = await pool.query(query, params);

        res.render("home.ejs", { books: books, search: search });

    } catch (err) {
        console.error("Error loading books:", err);
        res.render("home.ejs", { 
            error: "Could not load books. Please try again.", 
            books: [], 
            search: search 
        });
    }
});

//get admin login page
app.get("/admin", alreadyLoggedIn, (req, res) => {
    res.render("adminLogin.ejs");
});


//check valid admin and redirect to dashboard
app.post("/admin", async (req, res) => {
    const { username, password } = req.body;

    try {
        const sql = "SELECT username, password_hash FROM admins WHERE username = ?";
        const [users] = await pool.query(sql, [username]);

        // Check if user exists
        if (users.length === 0) {
            req.flash("error", "Username doesnt exist, please try again");
            return res.redirect("/admin");
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (isMatch) {
            // console.log("Admin authenticated:", user);
            req.session.admin = user.username; 
            req.flash("success", "Logged in successfully!");
            res.redirect("/admin/dashboard");
        } else {
            req.flash("error", "Invalid username or password");
            res.redirect("/admin");
        }

    } catch (err) {
        console.error("Admin login error:", err);
        req.flash("error", "An unexpected error occurred. Please try again.");
        res.redirect("/admin");
    }
});

//admin homepage
app.get("/admin/dashboard", isAdminLoggedIn, (req, res) => {
    res.render("adminDash.ejs", { admin: req.session.admin});
});

//admin logout confirm
app.get("/admin/logout", isAdminLoggedIn, (req, res) => {
    res.render("confirmLogout.ejs");
});


//confirmed logout
app.post("/admin/logout", isAdminLoggedIn, (req, res) => {
    req.flash("success", "You have been logged out successfully!");
    delete req.session.admin;
    res.redirect("/");
}); 


//fetch and display all books on adminBooks page
app.get("/admin/books", isAdminLoggedIn, async (req, res) => {
    const search = req.query.search;
    let query = "SELECT * FROM tempBooks";
    let params = [];

    if (search) {
        query += " WHERE book_name LIKE ? OR author LIKE ? OR category LIKE ? OR status LIKE ?";
        const term = `%${search}%`;
        params = [term, term, term, term];
    }

    try {
        const [books] = await pool.query(query, params);
        res.render("adminBooks.ejs", { books, search });

    } catch (err) {
        console.error("Error fetching books:", err);
        req.flash("error", "Failed to fetch books.");
        res.redirect("/admin/dashboard");
    }
});

//add new book details
app.get("/admin/books/new", isAdminLoggedIn, (req, res) => {
    res.render("addBook.ejs");
});

//extract books from image using Gemini Vision API
app.post("/admin/books/extract-bulk", isAdminLoggedIn, async (req, res) => {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
        return res.status(400).json({ error: "No image provided" });
    }

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Gemini API key not configured" });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const extractionPrompt = `Extract book details from this image. Return a JSON array with the following structure for each book found:
[
  {
    "book_name": "exact book title",
    "author": "author name",
    "category": "subject/category",
    "link": "NA"
  }
]

Rules:
- Only extract clearly visible books
- If a field is not visible, use "NA"
- Return ONLY valid JSON array, no additional text
- Ensure book_name and author are not empty if visible
- Extract 7-10 books if available`;

        // Remove the data URL prefix and preserve the original mime type when available
        const mimeTypeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/png";
        const base64Data = imageBase64.split(',')[1] || imageBase64;

        const response = await model.generateContent([
            extractionPrompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType,
                },
            },
        ]);

        const responseText = response.response.text();
        
        // Parse JSON from response
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return res.status(400).json({ error: "Could not extract valid JSON from response" });
        }

        const extractedBooks = JSON.parse(jsonMatch[0]);

        // Validate extracted data
        const validatedBooks = extractedBooks.map(book => ({
            book_name: (book.book_name || "").trim() || "Unknown",
            author: (book.author || "").trim() || "NA",
            category: (book.category || "").trim() || "NA",
            link: (book.link || "").trim() || "NA"
        }));

        res.json({ success: true, books: validatedBooks });

    } catch (err) {
        console.error("Error extracting books from image:", err);
        res.status(500).json({ error: "Failed to extract books: " + err.message });
    }
});

//bulk insert multiple books into database
app.post("/admin/books/bulk-insert", isAdminLoggedIn, async (req, res) => {
    const { books } = req.body;

    if (!Array.isArray(books) || books.length === 0) {
        req.flash("error", "No books provided");
        return res.redirect("/admin/books");
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        for (const book of books) {
            const { bookName, author, category, link } = book;
            
            // Validate required fields
            if (!bookName || bookName.trim() === "") {
                await conn.rollback();
                req.flash("error", "Book name is required for all books");
                return res.redirect("/admin/books");
            }

            const status = "Available";
            const sql = "INSERT INTO tempBooks (book_name, author, category, status, link) VALUES (?, ?, ?, ?, ?)";
            const values = [bookName.trim(), author.trim(), category.trim(), status, (link || "NA").trim()];

            await conn.query(sql, values);
        }

        await conn.commit();
        req.flash("success", `Successfully added ${books.length} books to the library!`);
        res.redirect("/admin/books");

    } catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (rollbackErr) {
                console.error("Rollback error:", rollbackErr);
            }
        }
        console.error("Error during bulk insert:", err);
        req.flash("error", "Failed to add books. Please try again.");
        res.redirect("/admin/books");
    } finally {
        if (conn) {
            conn.release();
        }
    }
});


//add new book to library
app.post("/admin/books", isAdminLoggedIn, async (req, res) => {
    const { bookName, author, category, link } = req.body;
    const status = "Available";
    const sql = "INSERT INTO tempBooks (book_name, author, category, status, link) VALUES (?, ?, ?, ?, ?)";
    const values = [bookName, author, category, status, link];

    try {
        await pool.query(sql, values);
        req.flash("success", "Book successfully added to the library!");
        res.redirect("/admin/books");

    } catch (err) {
        console.error("Error inserting book:", err);
        req.flash("error", "Failed to add book. Please enter valid details.");
        res.redirect("/admin/books/new");
    }
});



//GET book details page to upadate
app.get("/admin/books/:id", isAdminLoggedIn, async (req, res) => {
    const { id } = req.params;
    const sql = "SELECT * FROM tempBooks WHERE id = ?";

    try {
        const [books] = await pool.query(sql, [id]);

        //book not found
        if (books.length === 0) {
            req.flash("error", "Book not found.");
            return res.redirect("/admin/books");
        }
        res.render("bookUpdate.ejs", { book: books[0] });

    } catch (err) {
        console.error("Error retrieving book:", err);
        req.flash("error", "Failed to retrieve book details.");
        res.redirect("/admin/books");
    }
});


//Reflect change in database and render all books page
app.patch("/admin/books/:id", isAdminLoggedIn, async (req, res) => {
    const { id } = req.params;
    const { bookName, author, category, link } = req.body;
    const sql = "UPDATE tempBooks SET book_name = ?, author = ?, category = ?, link = ? WHERE id = ?";
    const values = [bookName, author, category, link, id];

    try {
        const [result] = await pool.query(sql, values);

        // affectedRows == 0 -> book was not found (some error)
        if (result.affectedRows === 0) {
            req.flash("error", "Book not found or no changes were made.");
            return res.redirect(`/admin/books`);
        }

        req.flash("success", "Book details updated successfully!");
        res.redirect("/admin/books");

    } catch (err) {
        console.error("Error updating book:", err);
        req.flash("error", "Failed to update book. Please try again.");
        res.redirect(`/admin/books/${id}`);
    }
});

//Remove book from library
app.delete("/admin/books/:id", isAdminLoggedIn, async (req, res) => {
    const { id } = req.params;
    let connection;

    try {
        connection = await pool.getConnection();

        //begin Tx
        await connection.beginTransaction();

        const deleteSql = "DELETE FROM tempBooks WHERE id = ?";
        const [deleteResult] = await connection.query(deleteSql, [id]);

        // if book not found/deleted, terminate Tx
        if (deleteResult.affectedRows === 0) {
            await connection.rollback();
            req.flash("error", "Book not found.");
            return res.redirect("/admin/books");
        }

        //book deleted -> move to next query
        const updateSql = "UPDATE reservations SET return_status = 'Deleted' WHERE book_id = ? AND return_status = 'Pending'";
        await connection.query(updateSql, [id]);

        //both queries successfully executed -> commit change to DB
        await connection.commit();

        req.flash("success", "Book deleted successfully!");
        res.redirect("/admin/books");

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error("Error during book deletion transaction:", err);
        req.flash("error", "An error occurred. The operation was cancelled.");
        res.redirect("/admin/books");
    } finally {
        // success/failure -> release connection 
        if (connection) {
            connection.release();
        }
    }
});

//reserve a book 
app.post("/bookReserve/:id", async (req, res) => {
    //use trim() ?
    const id =  req.params.id;
    const {name, contact} = req.body;
    if (!name || !contact) {
        req.flash("error", "Name and contact are required.");
        return res.redirect("/");
    }

    const conn = await pool.getConnection();
    try {
        let query1 = `INSERT INTO reservations (book_id, name, contact) VALUES (?, ?, ?)`;
        await conn.query(query1, [id, name, contact]);

        let query2 = `UPDATE tempBooks SET status = 'Borrowed' WHERE id = ?`;
        await conn.query(query2, [id]);

        req.flash("success", `"Book with ID ${id} reserved! We'll notify you via email when it's ready to collect."`)
        res.redirect("/");
    } finally {
        conn.release();
    }
});

//join waitlist for a book
app.post("/joinWaitlist/:id", async (req, res) => {
    const bookId = req.params.id;
    const { name, contact } = req.body;

    const query = `INSERT INTO waitlist (book_id, name, contact) VALUES (?, ?, ?)`;

    const conn = await pool.getConnection();
    try {
        await conn.query(query, [bookId, name.trim(), contact.trim()]);
        req.flash("success", `You've been added to the waitlist for Book ID ${bookId}. You'll be notified via email when it's available.`);
        res.redirect("/");
    } catch (err) {
        console.error("Error adding to waitlist:", err);
        req.flash("error", "Failed to join waitlist. Please try again.");
        return res.redirect("/");
    } finally {
        conn.release();
    }
});

//get all reservations and waitlist to display
app.get("/admin/requests", isAdminLoggedIn, async (req, res) => {
    //get all reservations
    const getReservationsQuery = `
        SELECT r.id, r.name AS user_name, r.contact, r.book_id, b.book_name, b.author, r.reserved_at, r.notified, r.collected, r.return_status
        FROM reservations r
        JOIN tempBooks b ON r.book_id = b.id
        WHERE r.return_status IN ('Pending', 'Overdue')
        ORDER BY r.reserved_at DESC
    `;
    //get waitlist
    const getWaitlistQuery = `
        SELECT w.id, w.name AS user_name, w.contact, w.book_id, b.book_name, b.author, w.joined_at
        FROM waitlist w
        JOIN tempBooks b ON w.book_id = b.id
        ORDER BY w.joined_at ASC
    `;

    try {
        const [reservationResults, waitlistResults] = await Promise.all([
            pool.query(getReservationsQuery),
            pool.query(getWaitlistQuery)
        ]);

        //get only query results
        const reservations = reservationResults[0];
        const waitlist = waitlistResults[0];

        res.render("requests.ejs", { reservations, waitlist });

    } catch (err) {
        // A single catch block handles errors from EITHER query
        console.error("Failed to fetch data:", err);
        res.status(500).render("requests.ejs", { 
            error: "Failed to fetch data from the server.", 
            reservations: [], 
            waitlist: [] 
        });
    }
});

//logic for notif btn to notify user to collect
app.post("/admin/notify/:id", isAdminLoggedIn, async (req, res) => {
    const id = req.params.id;
    const { email, book_name } = req.body;

    if (!email.includes("@")) {
        req.flash("error", "Invalid email address.");
        return res.redirect("/admin/requests");
    }

    const conn = await pool.getConnection();
    try {
        //console.log("email and password:", process.env.EMAIL_USER, process.env.EMAIL_PASS);
        const info = await sendReservationNotification(email, book_name);
        console.log("Email sent:", info.response);
        let query = `UPDATE reservations SET notified = true WHERE id = ?`;
        await conn.query(query, [id]);
        req.flash("success", `Notification sent to ${email}  `);
        res.redirect("/admin/requests");
    } catch (err) {
        if (err && err.response) {
            console.error("Error sending email:", err);
            req.flash("error", "Failed to send email. Please try again.");
            return res.redirect("/admin/requests");
        }
        console.error("Table update failed or email sending failed:", err);
        req.flash("error", "Table couldn't be updated.; please try again");
        return res.redirect("/admin/requests");
    } finally {
        conn.release();
    }
});

//delete reservation, check waitlist, promote if exists, else set book as available
app.post("/admin/deleteReservation/:id", isAdminLoggedIn, async (req, res) => {
    const reservationId = req.params.id;
    const { book_id } = req.body;

    const conn = await pool.getConnection();

    try {
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

        await conn.query(markReturned, [reservationId]);

        // Step 2: Check if waitlist exists
        const checkWaitlist = `SELECT * FROM waitlist WHERE book_id = ? ORDER BY joined_at ASC LIMIT 1`;
        const [waitlistRows] = await conn.query(checkWaitlist, [book_id]);

        if (waitlistRows.length === 0) {
            // No waitlist → Set book as Available
            console.log("waitlist details: ", waitlistRows);
            const setAvailable = `UPDATE tempBooks SET status = 'Available' WHERE id = ?`;
            await conn.query(setAvailable, [book_id]);
            req.flash("success", "Reservation deleted. Book marked as available.  ");
            return res.redirect("/admin/requests");
        }

        // Waitlist exists → Promote first person
        const nextUser = waitlistRows[0];
        const moveToReservations = `
                    INSERT INTO reservations (book_id, name, contact)
                    VALUES (?, ?, ?)
                `;
        await conn.query(moveToReservations, [book_id, nextUser.name, nextUser.contact]);

        const [resx] = await conn.query(`SELECT book_name from tempBooks where id = ?`, [book_id]);
        if (resx.length === 0) {
            req.flash("error", "No book found with the given ID.");
            return res.redirect("/admin/requests");
        }

        const book = resx[0].book_name;
        if (nextUser.contact.includes("@")) {
            console.log("Book name: ",book);
            await movedToReservation(nextUser.contact, book);
            console.log(`Email sent to ${nextUser.contact}`);
            let query = `UPDATE reservations SET notified = true WHERE name = ? AND book_id = ?`;
            await conn.query(query, [nextUser.name, book_id]);

            const removeFromWaitlist = `DELETE FROM waitlist WHERE id = ?`;
            await conn.query(removeFromWaitlist, [nextUser.id]);

            req.flash("success", `${nextUser.name} is now next in line. Previous reservation marked as returned.  `);
            return res.redirect("/admin/requests");
        }

        const removeFromWaitlist = `DELETE FROM waitlist WHERE id = ?`;
        await conn.query(removeFromWaitlist, [nextUser.id]);

        req.flash("success", `${nextUser.name} is now next in line. Previous reservation moved to reservation history.`);
        return res.redirect("/admin/requests");
    } catch (err) {
        if (err && err.message) {
            if (String(err.message).includes("Email")) {
                console.error("Email failed:", err);
                req.flash("error", "Failed to send email. Please try again.");
                return res.redirect("/admin/requests");
            }
        }
        console.error("Failed to update reservation status:", err);
        req.flash("error", "Failed to update reservation status.");
        return res.redirect("/admin/requests");
    } finally {
        conn.release();
    }
});

//mark reservation as collected
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

//display reservation history with search functionality
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

//notify user of overdue reservation and update status to overdue_notified
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