## History

In my last round of unemployment, I had a spreadsheet I built for myself to keep track of all my applications. Company, title, compensation, brief round notes, temperature, dates, application medium, and more were all in there. I ended up hiding rows that were no longer relevant either from ghosting or rejection. The visible rows represented the current state of my journey, but didn’t really provide me with great insights. 

This time around, I decided to truly overengineer the answer. This would have multiple benefits. I could talk about my experiences architecting and assembling it during interviews. Folks love hearing about leveraging AI, and I can certainly get a model to do something useful here. I could make this great writeup to showcase my communication skills. Above all else, I could actually use it!

It's also worth noting that I wanted to keep the hosting costs at $0. Not having an income is a driver here, but the additional constraints also force some creative solutioning.  

## Enter Callback

The initial idea was a simple app to track my applications. From there, I realized I would need a couple of other data models: companies, contacts, and events. So far, we’re talking pretty straightforward CRUD stuff. I put together the models and with some help from Claude, I had a web app deployed to Vercel including a hobby tier database to back it by the end of the day. I called it Callback. I slapped in some oauth from GitHub to support the potential for multiple users in the future. Great! Let’s complicate it.

## History of Fred

I really wanted to be able to build something enabled by AI during my time off work. Last time, I started messing with Ollama and Openclaw. On my desktop that has an Nvidia 3070 chip, I decided to shoehorn in the largest model I could fit in VRAM. This ended up being a quantized 9b model. Qwen3.5:9b-q4_K_M to be precise. It did barely fit on the graphics card, and I named my new assistant Fred.

Fred had his own gmail account with shared access to the family calendar, and also had access to our home’s Hue bulbs. I could message with it over Telegram. It would take forever to do anything; it was faster to open the Hue app and adjust the living room lights than it was to give Fred an instruction to do it by an order of magnitude. I also had it parse my calendar and summarize both my wife’s and my events for the following day along with the weather. 

One day, it got hung up on waffling about whether 19 degrees is just a really cold April day here in New Jersey or if it was just Celsius. It took so long and wrote so much about its indecision that I ended up killing the job. Quantized models are apparently more prone to this type of paralysis, I learned. Also, the extra overhead in the md files in the OpenClaw framework were bogging things down. 

Still, my experience standing up a local model taught me a lot, and talking through it all during interviews was a help. I have it on good authority that it was one of the reasons I got hired at Wizard working on an AI product. Anyway, time has passed, and Fred has gone to sleep.

## The Overcomplication

I decided that looking at a job application update email of any kind, and then manually feeding the pertinent data to Callback would be too tedious. I’m an engineer. Let’s do some engineering. I want to be able to forward such emails to another account I control, have it comb through the email, and make the updates in Callback itself. Getting the Ollama container running again was easy. I installed a few smaller models, phi3.5, gemma3:4b, qwen2.5:7b-instruct, and llama3.1:8b. I also spun up a new repo to house a worker. Its job would ultimately be to shuttle email data to the model, and send the results over to Callback. However, it wasn’t going to be that simple. It never is.

### Starting Execution

I decided to start in the middle of that process with the most important component: the AI parsing. If I couldn't get the crux of it to work well enough, then I wouldn't need to bother with the rest of it. However, to get the parsing prompts to run well, I would need to pare down the email data I send it to keep the context constrained for these smaller models. 

With Claude’s help again, I created the part of the worker that would parse .eml files, trim out threads and forwarding info, and create a consistent structure to send to the model. I downloaded a dozen emails of varying content related to my previous job hunt. I was then able to test the models against the cleaned up, real world email content. 

### Testing Models
I started with the smallest model. After all, if I can accomplish my goals using fewer resources, I will do so. First up was Phi3.5. I was mostly ok. 10/12 emails returned what looked like good results. The other two were outright failures. It decided to ignore a length cap on a field and then wound up with invalid JSON because of the unterminated string. It wasn’t a prompt issue but a limitation of the model. 

Gemma was better. There were no invalid results, but it missed on some of the content, mistaking the recruiting agency for the hiring company, for example. Following some suggestions from Claude, I revised the prompting, and got closer but ultimately hit the ceiling of the model for this purpose. 

Qwen2.5 was a big jump forward. With a little more prompt tweaking, it was about 99% correct. I was even able to pare down some of the specific examples in the prompts I had to give Gemma, and the smaller prompts ran just as well. Qwen it is, then!

### The Rest of the Owl
I still had to pull the emails from the inbox, and send the transform results to Callback. 

I decided early on that since the model for this was never going to end up in the cloud, the worker could just run in another container alongside Ollama on my Desktop PC. I spun up a Google project, created an API client with permissions to see and send emails from Fred’s address. 

Since I wasn’t paying for cloud usage of the worker and didn't have to worry about usage, it could poll Fred’s inbox every 60 seconds. To make sure the AI only got its hands on the right emails, I would forward everything for Callback to `<fredsaddress>+callback@gmail`. From there, the worker would pick up anything sent to +callback, assign a `callback/processing` label, and once complete, it would add either `callback/processed` or `callback/error`. The worker ran the preprocessing, invoked the model, and then responded to the forwarded email (back to me) with the result as well as generate a delta for the Callback app.

It’s all relatively straightforward, but I had to navigate a few trapdoors that popped up. Most of these cases involved tuning the model prompts to get the desired outputs, but some included changing the contract between the worker and Callback. Some were as simple as adding a new Application status which involved matching updates in the app and the worker, but other issues were more complicated like dealing with a recruiter email that included multiple job descriptions.

## Diagram
<img width="933" height="617" alt="Excalidraw architecture diagram" src="https://github.com/user-attachments/assets/fe2d452a-e445-4801-9c35-f21e675ad8f1" />

[Excalidraw link](https://excalidraw.com/#json=YIXyRAKI_Bp-bxJOIdcNj,-EeH9ZeFL3ocWfGp5AK7HQ)

## The Present

The original vision was for the updates to be applied automatically, but I would be reviewing them for correctness either way, even if only to satisfy my own curiosity. What's a couple of clicks on top of that?

Given that the tradeoff is 2 clicks versus blind trust in AI for something as impactful to me as job applications, I'll make the clicks, even if over 90% of the time I don't make any changes to the proposed changes before sending them.


## The Future

For the next time I find myself on the market, I'll likely revisit this to add whatever organizational tools would help across multiple searches. Aside from that, I don't have big plans in mind.
