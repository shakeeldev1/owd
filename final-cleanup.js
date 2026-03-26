// Final cleanup: ensure ONLY one settings document exists with correct values
const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

async function finalCleanup() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected');

    const settingsCollection = mongoose.connection.db.collection('settings');
    
    // Show ALL documents
    console.log('\n📋 ALL current settings documents:');
    const allDocs = await settingsCollection.find({}).toArray();
    console.log(`Total documents: ${allDocs.length}`);
    allDocs.forEach((doc, idx) => {
      console.log(`\nDocument ${idx + 1}:`);
      console.log(`  _id: ${doc._id}`);
      console.log(`  whatsappNumber: ${doc.whatsappNumber}`);
    });

    if (allDocs.length > 1) {
      console.log('\n⚠️  MULTIPLE documents detected! Deleting all and creating ONE fresh document...');
      
      // Delete ALL
      const deleteResult = await settingsCollection.deleteMany({});
      console.log(`\n🗑️  Deleted ${deleteResult.deletedCount} documents`);
    } else {
      console.log('\n✅ Only one document exists, updating it...');
    }

    // Create/update with correct values
    const correctSettings = {
      whatsappEnabled: true,
      whatsappNumber: '97471378000',  // NO plus sign
      language: 'en',
      storeName: 'Oud Al Zubarah',
      storeEmail: 'info@oudalzubarah.qa',
      storePhone: '+974 4444 5555',
      storeAddress: 'Pearl, Doha, Qatar',
      storeHours: 'Saturday - Thursday: 10AM - 10PM',
      currency: 'QAR',
      emailNotifications: true,
      orderNotifications: true,
      stockAlerts: true,
      marketingEmails: false,
      twoFactorAuth: false,
      sessionTimeout: '30',
      creditCardEnabled: true,
      applePayEnabled: true,
      bankTransferEnabled: true,
      cashOnDeliveryEnabled: true,
      skipCashEnabled: true,
      freeShippingThreshold: '200',
      standardShippingFee: '25',
    };

    console.log(`\n✨ Creating/updating settings with correct values...`);
    const result = await settingsCollection.deleteMany({});
    const inserted = await settingsCollection.insertOne(correctSettings);
    console.log(`Inserted ID: ${inserted.insertedId}`);

    // Final verification
    console.log('\n✅ Final verification:');
    const final = await settingsCollection.findOne({});
    console.log(`Total documents in collection: ${await settingsCollection.countDocuments()}`);
    console.log(`WhatsApp number: ${final.whatsappNumber}`);
    console.log(`WhatsApp enabled: ${final.whatsappEnabled}`);

    await mongoose.connection.close();
    console.log('\n✅ Cleanup complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

finalCleanup();
