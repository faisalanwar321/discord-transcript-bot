const { Client, GatewayIntentBits } = require('discord.js');
const { Client: NotionClient } = require('@notionhq/client');
const fetch = require('node-fetch');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ARCHIVE_CHANNEL_ID = process.env.ARCHIVE_CHANNEL_ID;

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const notion = new NotionClient({ auth: NOTION_TOKEN });

async function parseTranscript(htmlUrl) {
  try {
    console.log('[INFO] Downloading transcript from:', htmlUrl);
    
    const response = await fetch(htmlUrl);
    const htmlContent = await response.text();
    
    const messagesMatch = htmlContent.match(/let messages = "([^"]+)"/);
    const channelMatch = htmlContent.match(/let channel = "([^"]+)"/);
    const serverMatch = htmlContent.match(/let server = "([^"]+)"/);
    
    if (!messagesMatch) {
      throw new Error('No messages found in transcript');
    }
    
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
    
    let transcript = 'Server: ' + serverName + '\n';
    transcript += 'Channel: ' + channelName + '\n\n';
    transcript += '========================================\n\n';
    
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
        
        transcript += '[' + time + '] ' + username + ':\n';
        transcript += content + '\n\n';
        userMsgCount++;
      }
    });
    
    console.log('[INFO] Parsed', userMsgCount, 'user messages');
    
    return {
      transcript: transcript,
      ticketName: channelName,
      serverName: serverName,
      messageCount: userMsgCount
    };
    
  } catch (error) {
    console.error('[ERROR] Parse error:', error.message);
    throw error;
  }
}

async function sendToNotion(data, transcriptUrl, embedData) {
  try {
    console.log('[INFO] Sending to Notion:', data.ticketName);
    
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
    
    console.log('[SUCCESS] Saved to Notion:', response.url);
    return response;
    
  } catch (error) {
    console.error('[ERROR] Notion error:', error.message);
    
    if (error.code === 'validation_error') {
      console.log('[WARN] Retrying with minimal properties...');
      
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
      
      console.log('[SUCCESS] Saved with minimal properties:', response.url);
      return response;
    }
    
    throw error;
  }
}

discordClient.once('ready', () => {
  console.log('[BOT] Logged in as:', discordClient.user.tag);
  console.log('[BOT] Monitoring channel ID:', ARCHIVE_CHANNEL_ID);
  console.log('[BOT] Ready and listening for transcripts!');
});

discordClient.on('messageCreate', async (message) => {
  try {
    if (message.channel.id !== ARCHIVE_CHANNEL_ID) return;
    
    const htmlAttachment = message.attachments.find(att => 
      att.name.endsWith('.html') && att.name.includes('transcript')
    );
    
    if (!htmlAttachment) return;
    
    console.log('[TRANSCRIPT] New transcript detected:', htmlAttachment.name);
    
    const embed = message.embeds[0];
    if (!embed) {
      console.log('[WARN] No embed found, skipping');
      return;
    }
    
    const parsed = await parseTranscript(htmlAttachment.url);
    await sendToNotion(parsed, htmlAttachment.url, embed);
    await message.react('✅');
    
    console.log('[SUCCESS] Transcript processed successfully');
    
  } catch (error) {
    console.error('[ERROR] Failed to process transcript:', error.message);
    try {
      await message.react('❌');
    } catch (e) {
      console.error('[ERROR] Could not add reaction:', e.message);
    }
  }
});

discordClient.on('error', error => {
  console.error('[ERROR] Discord client error:', error.message);
});

process.on('unhandledRejection', error => {
  console.error('[ERROR] Unhandled promise rejection:', error);
});

console.log('[STARTUP] Starting Discord bot...');
discordClient.login(DISCORD_TOKEN);
