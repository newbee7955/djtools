interface Sender { id:number; mainFrame: {url:string} }
export function isTrustedHostRequest(event:{sender:Sender;senderFrame?:{url:string}|null},host:Sender|undefined,expectedUrl:string):boolean {
  return Boolean(host && event.sender === host && event.sender.id === host.id && event.senderFrame === host.mainFrame && event.senderFrame?.url === expectedUrl)
}
