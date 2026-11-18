import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lrsMetadata} from '../../seo/metadata';
export const metadata=lrsMetadata({title:'符文遊戲房間｜LunaRunes',description:'符文遊戲房間由 LunaRunes 提供。',path:'/game/room/'});
export default function GameRoomRedirect(){return <LrsWebRedirect path="/game/room/"/>;}
