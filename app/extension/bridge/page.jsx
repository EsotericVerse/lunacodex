import GalaxyLinkBridge from './GalaxyLinkBridge';

export const metadata={
 title:'LOC galaxy-link｜彩虹橋',
 description:'連接屬於你的文字銀河。透過 LOC 網站既有登入狀態，完成 Extension 批次文章寫入。',
 robots:{index:false,follow:false}
};

export default function ExtensionBridgePage(){return <GalaxyLinkBridge/>;}
