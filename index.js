const { Client, GatewayIntentBits } = require('discord.js');
const { Client: NotionClient } = require('@notionhq/client');
const fetch = require('node-fetch');

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ARCHIVE_CHANNEL_ID = process.env.ARCHIVE_CHANNEL_ID;

// Initialize clients
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const notion = new NotionClient({ auth: NOTION_TOKEN });

// Parse TicketTool transcript
async function parseTranscript(htmlUrl) {
  try {
    console.log(`📥 Downloading: ${htmlUrl}`);
    
    const response = await fetch(htmlUrl);
    const htmlContent = await response.text();
    
    // Extract base64
    const messagesMatch = htmlContent.match(/let messages = "([^"]+)"/);
    const channelMatch = htmlContent.match(/let channel = "([^"]+)"/);
    const serverMatch = htmlContent.match(/let server = "([^"]+)"/);
    
    if (!messagesMatch) {
      throw new Error('No messages found');
    }
    
    // Decode
    const messagesJSON = Buffer.from(messagesMatch[1], 'base64').toString('utf-8');
    const messages = JSON.parse(messagesJSON);
    
    let channelName = 'Unknown';
    let serverName = 'Unknown';
    
    if (channelMatch) {
      channelName = JSON.parse(Buffer.from(channelMatch[1], 'base64').toString('utf-8')).name;
    }
    
    if (serverMatch) {
      serverName = JSON.parse(Buffer.from(serverMatch[1], 'base64').toString('utf-8')).name;
    }
    
    // Build transcript
    let transcript = `📋 Server: ${serverName}\n📌 Channel: ${channelName}\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    let userMsgCount = 0;
    
    messages.forEach(msg => {
      const username = msg.nick || msg.username || 'Unknown';
      const content = msg.content || '';
      
      if (content.trim() && !msg.bot) {
        const time = new Date(msg.created).toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          dateStyle: 'medium',
          timeStyle: 'short'
        });
        
        transcript += `🕐 ${time}\n👤 ${username}\n💬 ${content}\n\n`;
        userMsgCount++;
      }
    });
    
    return {
      transcript,
      ticketName: channelName,
      serverName,
      messageCount: userMsgCount
    };
    
  } catch (error) {
    console.error('❌ Parse error:', error);
    throw error;
  }
}

// Send to Notion
async function sendToNotion(data, transcriptUrl, embedData) {
  try {
    console.log(`📤 Sending to Notion: ${data.ticketName}`);
    
    const ticketOwner = embedData.fields.find(f => f.name === 'Ticket Owner')?.value || 'Unknown';
    const panelName = embedData.fields.find(f => f.name === 'Panel Name')?.value || 'Unknown';
    
    const response = await notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        'Name': {
          title: [{ text: { content: data.ticketName } }]
        },
        'Status': {
          select: { name: 'Closed' }
        },
        'Panel': {
          rich_text: [{ text: { content: panelName } }]
        },
        'Owner': {
          rich_text: [{ text: { content: ticketOwner.replace(/<@|>/g, '') } }]
        },
        'Messages': {
          number: data.messageCount
        },
        'Transcript URL': {
          url: transcriptUrl
        }
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: data.transcript.substring(0, 2000) } }]
          }
        }
      ]
    });
    
    console.log(`✅ Saved: ${response.url}`);
    return response;
    
  } catch (error) {
    console.error('❌ Notion error:', error.message);
    
    // Retry with minimal properties
    if (error.code === 'validation_error') {
      console.log('⚠️ Retrying with minimal properties...');
      
      const response = await notion.pages.create({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          'Name': {
            title: [{ text: { content: data.ticketName } }]
          }
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: data.transcript.substring(0, 2000) } }]
            }
          }
        ]
      });
      
      console.log(`✅ Saved (minimal): ${response.url}`);
      return response;
    }
    
    throw error;
  }
}

// Discord ready
discordClient.once('ready', () => {
  console.log(`🤖 Bot: ${discordClient.user.tag}`);
  console.log(`📺 Monitoring: ${ARCHIVE_CHANNEL_ID}`);
  console.log(`✅ Ready!`);
});

// Monitor messages
discordClient.on('messageCreate', async (message) => {
  try {
    if (message.channel.id !== ARCHIVE_CHANNEL_ID) return;
    
    const htmlAttachment = message.attachments.find(att => 
      att.name.endsWith('.html') && att.name.includes('transcript')
    );
    
    if (!htmlAttachment) return;
    
    console.log(`\n🎫 New transcript: ${htmlAttachment.name}`);
    
    const embed = message.embeds[0];
    if (!embed) {
      console.log('⚠️ No embed');
      return;
    }
    
    const parsed = await parseTranscript(htmlAttachment.url);
    await sendToNotion(parsed, htmlAttachment.url, embed);
    await message.react('✅');
    
  } catch (error) {
    console.error('❌ Error:', error);
    try {
      await message.react('❌');
    } catch (e) {}
  }
});

// Error handling
discordClient.on('error', error => {
  console.error('❌ Discord error:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled:', error);
});

// Start
console.log('🚀 Starting bot...');
discordClient.login(DISCORD_TOKEN);
```


