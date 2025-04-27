require('dotenv').config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,      // Replace with your email
        pass: process.env.EMAIL_PASS          // Replace with your app-specific password
    }
});

function sendReservationNotification(to, bookName) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: "Library Book Reservation Ready!",
        text: `Hello! Your reserved book "${bookName}" is now ready for pickup. Please collect it within 24 hours to avoid getting your request deleted.`,
        html: `
            <h2>Book Reservation Ready!</h2>
            <p>Hello,</p>
            <p>Your reserved book <strong>"${bookName}"</strong> is now ready for pickup.</p>
            <p>Please collect it within <strong>24 hours</strong> to avoid having your request deleted.</p>
            <p>Thank you!</p>
        `
    };

    return transporter.sendMail(mailOptions);
}

function movedToReservation(to, bookName) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: `${bookName} is now available for you!`,
        text: `Hi there! The book you were waiting for (${bookName}) is now available and reserved in your name. Please collect it within the next 24 hours to avoid cancellation. You received this because you were next in line on the waitlist.`,
        html: `
            <h2>Good News!</h2>
            <p>Hi there,</p>
            <p>The book you were waiting for — <strong>${bookName}</strong> — is now available and has been reserved for you.</p>
            <p>Please make sure to collect it within <strong>24 hours</strong> to avoid cancellation.</p>
            <p>You received this email because you were first on the waitlist. 😊</p>
            <p>Best regards,</p>
            <p>Your Library Team</p>
        `
    };

    return transporter.sendMail(mailOptions);
}

function reminderEmail(to, bookName) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: "⏰ Reminder: Book Reservation Expiring Soon",
        text: `Hi! This is a friendly reminder that your reserved book "${bookName}" will expire in 2 hours. Please collect it soon!`,
        html: `
            <h2>Reservation Expiring Soon!</h2>
            <p>Hi,</p>
            <p>This is a friendly reminder that your reserved book <strong>"${bookName}"</strong> will expire in <strong>2 hours</strong>.</p>
            <p>Please collect it soon to avoid cancellation.</p>
            <p>Thank you!</p>
        `
    };

    return transporter.sendMail(mailOptions);

}

function expiredReservationEmail(to, bookName) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: "❌ Reservation Expired",
        text: `Hi! Your reservation for "${bookName}" has expired as it was not collected within 24 hours.`,
        html: `
            <h2>Reservation Expired</h2>
            <p>Hi,</p>
            <p>Your reservation for <strong>"${bookName}"</strong> has expired as it was not collected within 24 hours.</p>
            <p>Please contact the library if you still wish to reserve this book.</p>
            <p>Best regards,</p>
            <p>Your Library Team</p>
        `    };

    return transporter.sendMail(mailOptions);
}

function dueReminderEmail(to, bookName) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: "📚 Book Due Reminder",
        text: `Hi! Just a friendly reminder that "${bookName}" is due soon. Kindly return it within the due date to avoid any unneccesary dues. 😊`,
        html: `
            <h2>Book Due Reminder</h2>
            <p>Hi,</p>
            <p>Just a friendly reminder that <strong>"${bookName}"</strong> is due soon.</p>
            <p>Kindly return it by the due date to avoid any unnecessary dues. 😊</p>
            <p>Thank you!</p>
        `
    };

    return transporter.sendMail(mailOptions);
}

function sendOverdueEmail(to, userName, bookName) {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to,
      subject: "⏰ Book Reservation Overdue",
      text: `Hi ${userName},\n\nYou have passed the due date for the book "${bookName}". Please return it at the earliest to avoid the accumulation of unnecessary dues.`,
        html: `
            <h2>Book Overdue Notice</h2>
            <p>Hi ${userName},</p>
            <p>You have passed the due date for the book <strong>"${bookName}"</strong>.</p>
            <p>Please return it at the earliest to avoid the accumulation of unnecessary dues.</p>
            <p>Thank you for your prompt attention!</p>
            <p>Best regards,</p>
            <p>Your Library Team</p>
        `
    };
  
    return transporter.sendMail(mailOptions);
  }

module.exports = { sendReservationNotification, movedToReservation, reminderEmail, expiredReservationEmail, dueReminderEmail, sendOverdueEmail };
