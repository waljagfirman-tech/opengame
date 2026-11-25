System.register("chunks:///_virtual/setting",["./SettingUI.ts"],(function(){return{setters:[null],execute:function(){}}}));

System.register("chunks:///_virtual/SettingUI.ts",["./rollupPluginModLoBabelHelpers.js","cc","./Main.ts","./GameDefine.ts"],(function(e){var t,i,n,c,o,s,l,u,h,r,a,C,d,p;return{setters:[function(e){t=e.inheritsLoose},function(e){i=e.cclegacy},function(e){n=e.ccclass,c=e._platform,o=e.EBottomAdType,s=e.EPlatformType,l=e._guide,u=e._gameType,h=e._privacy,r=e._audio,a=e.EUILayer,C=e.EBlockOnceAdType,d=e.BaseUI},function(e){p=e.initData}],execute:function(){var f;i._RF.push({},"52af3yS6apPi5dNpKPnKLiB","SettingUI",void 0);e("SettingUI",n("SettingUI")(f=function(e){function i(){for(var t,i=arguments.length,n=new Array(i),c=0;c<i;c++)n[c]=arguments[c];return(t=e.call.apply(e,[this].concat(n))||this).layerType=a.Panel,t.blockOnceAdType=C.Show,t.cSwitchChildrenCC_music=null,t.cSwitchChildrenCC_sound=null,t.cSwitchChildrenCC_btn=null,t.cBtns=null,t.cAUser=null,t.cADec=null,t}t(i,e);var n=i.prototype;return n.onCreate=function(){switch(c.type){case s.wx:case s.vivo:case s.oppo:this.bottomAdType=o.Native;break;default:this.bottomAdType=o.Banner}},n.onOpen=function(){this.updateView(),l.closeFinger(),p.openPrivacy?(this.cAUser.active=!0,this.cADec.active=!0):(this.cAUser.active=!1,this.cADec.active=!1),u.isRun?this.cSwitchChildrenCC_btn.index=0:this.cSwitchChildrenCC_btn.index=1},n.onClickReset=function(){u.hasRun()&&(this.closeUI(),u.reset())},n.onClickExit=function(){this.closeUI(),u.settingExit()},n.onClickAUser=function(){h.openUserUI()},n.onClickADec=function(){h.openDecUI()},n.onClickSwitchChildrenCC_music=function(){1==r.getVolume(!0)?r.setVolume(!0,0):r.setVolume(!0,1),this.updateView()},n.onClickSwitchChildrenCC_sound=function(){1==r.getVolume(!1)?r.setVolume(!1,0):r.setVolume(!1,1),this.updateView()},n.updateView=function(){1==r.getVolume(!0)?this.cSwitchChildrenCC_music.index=0:this.cSwitchChildrenCC_music.index=1,1==r.getVolume(!1)?this.cSwitchChildrenCC_sound.index=0:this.cSwitchChildrenCC_sound.index=1},i}(d))||f);i._RF.pop()}}}));

(function(r) {
  r('virtual:///prerequisite-imports/setting', 'chunks:///_virtual/setting'); 
})(function(mid, cid) {
    System.register(mid, [cid], function (_export, _context) {
    return {
        setters: [function(_m) {
            var _exportObj = {};

            for (var _key in _m) {
              if (_key !== "default" && _key !== "__esModule") _exportObj[_key] = _m[_key];
            }
      
            _export(_exportObj);
        }],
        execute: function () { }
    };
    });
});