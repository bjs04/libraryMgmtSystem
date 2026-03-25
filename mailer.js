require('dotenv').config();
const Brevo = require('@getbrevo/brevo');

// In v3, the classes are nested inside the main export
const apiInstance = new Brevo.TransactionalEmailsApi();

// Correct way to set the API Key in v3
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

/**
 * Helper function to send emails via Brevo API
 */
async function sendEmail({ to, subject, text, html }) {
    const sendSmtpEmail = new Brevo.SendSmtpEmail();

    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.textContent = text;
    sendSmtpEmail.sender = { "name": "LMS Library", "email": process.env.EMAIL_USER };
    sendSmtpEmail.to = [{ "email": to }];

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('✅ Email sent successfully via Brevo API');
        return data;
    } catch (error) {
        // Detailed error logging to help us if it fails again
        console.error("❌ Brevo API Error:", error.response ? error.response.body : error.message);
        throw error;
    }
}

function sendReservationNotification(to, bookName) {
    return sendEmail({
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
    });
}

function movedToReservation(to, bookName) {
    return sendEmail({
        to,
        subject: `${bookName} is now available for you!`,
        text: `Hi there! The book you were waiting for (${bookName}) is now available and reserved in your name.`,
        html: `
            <h2>Good News!</h2>
            <p>Hi there,</p>
            <p>The book you were waiting for — <strong>${bookName}</strong> — is now available and has been reserved for you.</p>
            <p>Please make sure to collect it within <strong>24 hours</strong> to avoid cancellation.</p>
            <p>Best regards,</p>
            <p>Your Library Team</p>
        `
    });
}

function reminderEmail(to, bookName) {
    return sendEmail({
        to,
        subject: "⏰ Reminder: Book Reservation Expiring Soon",
        text: `Hi! This is a friendly reminder that your reserved book "${bookName}" will expire in 2 hours.`,
        html: `
            <h2>Reservation Expiring Soon!</h2>
            <p>Hi,</p>
            <p>This is a friendly reminder that your reserved book <strong>"${bookName}"</strong> will expire in <strong>2 hours</strong>.</p>
            <p>Thank you!</p>
        `
    });
}

function expiredReservationEmail(to, bookName) {
    return sendEmail({
        to,
        subject: "❌ Reservation Expired",
        text: `Hi! Your reservation for "${bookName}" has expired.`,
        html: `
            <h2>Reservation Expired</h2>
            <p>Hi,</p>
            <p>Your reservation for <strong>"${bookName}"</strong> has expired as it was not collected within 24 hours.</p>
            <p>Best regards,</p>
            <p>Your Library Team</p>
        `
    });
}

function dueReminderEmail(to, bookName) {
    return sendEmail({
        to,
        subject: "📚 Book Due Reminder",
        text: `Hi! Just a friendly reminder that "${bookName}" is due soon.`,
        html: `
            <h2>Book Due Reminder</h2>
            <p>Hi,</p>
            <p>Just a friendly reminder that <strong>"${bookName}"</strong> is due soon.</p>
            <p>Kindly return it by the due date. 😊</p>
        `
    });
}

function sendOverdueEmail(to, userName, bookName) {
    return sendEmail({
        to,
        subject: "⏰ Book Reservation Overdue",
        text: `Hi ${userName},\n\nYou have passed the due date for the book "${bookName}".`,
        html: `
            <h2>Book Overdue Notice</h2>
            <p>Hi ${userName},</p>
            <p>You have passed the due date for the book <strong>"${bookName}"</strong>.</p>
            <p>Please return it at the earliest.</p>
            <p>Best regards,</p>
            <p>Your Library Team</p>
        `
    });
}

module.exports = { 
    sendReservationNotification, 
    movedToReservation, 
    reminderEmail, 
    expiredReservationEmail, 
    dueReminderEmail, 
    sendOverdueEmail 
};