// Script to update WhatsApp number in MongoDB Settings collection
const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

const settingsSchema = new mongoose.Schema({}, { collection: 'settings', strict: false });

async function updateWhatsAppNumber() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const Settings = mongoose.model('Settings', settingsSchema);

    // Update or create the settings document
    const result = await Settings.findOneAndUpdate(
      {}, // Find first document (or any existing one)
      {
        $set: {
          whatsappNumber: '97471378000',
        }
      },
      {
        new: true,
        upsert: true // Create if doesn't exist
      }
    );

    console.log('✅ WhatsApp number updated successfully!');
    console.log('Updated document:', {
      whatsappNumber: result?.whatsappNumber || '97471378000'
    });

    await mongoose.connection.close();
    console.log('✅ Connection closed');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

updateWhatsAppNumber();
