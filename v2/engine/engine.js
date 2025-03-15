/*
    LittleJS - The Little JavaScript Game Engine That Can - By Frank Force 2021

    Engine Features
    - Engine and debug system are separate from game code
    - Object oriented with base class engine object
    - Engine handles core update loop
    - Base class object handles update, physics, collision, rendering, etc
    - Engine helper classes and functions like Vector2, Color, and Timer
    - Super fast rendering system for tile sheets
    - Sound effects audio with zzfx and music with zzfxm
    - Input processing system with gamepad and touchscreen support
    - Tile layer rendering and collision system
    - Particle effect system
    - Automatically calls appInit(), appUpdate(), appUpdatePost(), appRender(), appRenderPost()
    - Debug tools and debug rendering system
    - Call engineInit() to start it up!
*/

'use strict';

///////////////////////////////////////////////////////////////////////////////
// engine config

const engineName = 'LittleJS';
const engineVersion = 'v0.74';
const FPS = 60, timeDelta = 1/FPS;
const defaultFont = 'arial'; // font used for text rendering
const maxWidth = 1920, maxHeight = 1200; // up to 1080p and 16:10
const fixedWidth = 0; // native resolution
//const fixedWidth = 1280, fixedHeight = 720; // 720p
//const fixedWidth = 128,  fixedHeight = 128; // PICO-8
//const fixedWidth = 240,  fixedHeight = 136; // TIC-80

// tile sheet settings
//const defaultTilesFilename = 'a.png'; // everything goes in one tile sheet
const defaultTileSize = vec2(16); // default size of tiles in pixels
const tileBleedShrinkFix = .3;    // prevent tile bleeding from neighbors
const pixelated = 1;              // use crisp pixels for pixel art

///////////////////////////////////////////////////////////////////////////////
// core engine

const gravity = -.01;
let mainCanvas=0, mainContext=0, mainCanvasSize=vec2();
let engineObjects=[], engineCollideObjects=[];
let frame=0, time=0, realTime=0, paused=0, frameTimeLastMS=0, frameTimeBufferMS=0, debugFPS=0;
let cameraPos=vec2(), cameraScale=4*max(defaultTileSize.x, defaultTileSize.y);
let tileImageSize, tileImageSizeInverse, shrinkTilesX, shrinkTilesY, drawCount;

const tileImage = new Image(); // the tile image used by everything
function engineInit(appInit, appUpdate, appUpdatePost, appRender, appRenderPost)
{
    // init engine when tiles load
    tileImage.onload = ()=>
    {
        // save tile image info
        tileImageSizeInverse = vec2(1).divide(tileImageSize = vec2(tileImage.width, tileImage.height));
        debug && (tileImage.onload=()=>ASSERT(1)); // tile sheet can not reloaded
        shrinkTilesX = tileBleedShrinkFix/tileImageSize.x;
        shrinkTilesY = tileBleedShrinkFix/tileImageSize.y;

        // setup html
        document.body.appendChild(mainCanvas = document.createElement('canvas'));
        document.body.style = 'margin:0;overflow:hidden;background:#000';
        mainCanvas.style = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);image-rendering:crisp-edges;image-rendering:pixelated';          // pixelated rendering
        mainContext = mainCanvas.getContext('2d');

        debugInit();
        glInit();
        appInit();
        engineUpdate();
    };

    // main update loop
    const engineUpdate = (frameTimeMS=0)=>
    {
        requestAnimationFrame(engineUpdate);
        
        if (!document.hasFocus())
            inputData[0].length = 0; // clear input when lost focus

        // prepare to update time
        const realFrameTimeDeltaMS = frameTimeMS - frameTimeLastMS;
        let frameTimeDeltaMS = realFrameTimeDeltaMS;
        frameTimeLastMS = frameTimeMS;
        realTime = frameTimeMS / 1e3;
        if (debug)
            frameTimeDeltaMS *= keyIsDown(107) ? 5 : keyIsDown(109) ? .2 : 1;
        if (!paused)
            frameTimeBufferMS += frameTimeDeltaMS;

        // update frame
        mousePosWorld = screenToWorld(mousePosScreen);
        updateGamepads();

        // apply time delta smoothing, improves smoothness of framerate in some browsers
        let deltaSmooth = 0;
        if (frameTimeBufferMS < 0 && frameTimeBufferMS > -9)
        {
            // force an update each frame if time is close enough (not just a fast refresh rate)
            deltaSmooth = frameTimeBufferMS;
            frameTimeBufferMS = 0;
            //debug && frameTimeBufferMS < 0 && console.log('time smoothing: ' + -deltaSmooth);
        }
        //debug && frameTimeBufferMS < 0 && console.log('skipped frame! ' + -frameTimeBufferMS);

        // clamp incase of extra long frames (slow framerate)
        frameTimeBufferMS = min(frameTimeBufferMS, 50);
        
        // update the frame
        for (;frameTimeBufferMS >= 0; frameTimeBufferMS -= 1e3 / FPS)
        {
            // main frame update
            appUpdate();
            engineUpdateObjects();
            appUpdatePost();
            debugUpdate();

            // update input
            for(let deviceInputData of inputData)
                deviceInputData.map(k=> k.r = k.p = 0);
            mouseWheel = 0;
        }

        // add the smoothing back in
        frameTimeBufferMS += deltaSmooth;

        if (fixedWidth)
        {
            // clear and fill window if smaller
            mainCanvas.width = fixedWidth;
            mainCanvas.height = fixedHeight;
            
            // fit to window width if smaller
            const fixedAspect = fixedWidth / fixedHeight;
            const aspect = innerWidth / innerHeight;
            mainCanvas.style.width = aspect < fixedAspect ? '100%' : '';
            mainCanvas.style.height = aspect < fixedAspect ? '' : '100%';
        }
        else
        {
            // fill the window
            mainCanvas.width = min(innerWidth, maxWidth);
            mainCanvas.height = min(innerHeight, maxHeight);
        }

        // save canvas size
        mainCanvasSize = vec2(mainCanvas.width, mainCanvas.height);
        mainContext.imageSmoothingEnabled = !pixelated; // disable smoothing for pixel art

        // render sort then render while removing destroyed objects
        glPreRender(mainCanvas.width, mainCanvas.height);
        appRender();
        engineObjects.sort((a,b)=> a.renderOrder - b.renderOrder);
        for(const o of engineObjects)
            o.destroyed || o.render();
        glCopyToContext(mainContext);
        appRenderPost();
        debugRender();

        if (showWatermark)
        {
            // update fps
            debugFPS = lerp(.05, 1e3/(realFrameTimeDeltaMS||1), debugFPS);
            mainContext.textAlign = 'right';
            mainContext.textBaseline = 'top';
            mainContext.font = '1em monospace';
            mainContext.fillStyle = '#000';
            const text = engineName + ' ' + engineVersion + ' / ' 
                + drawCount + ' / ' + engineObjects.length + ' / ' + debugFPS.toFixed(1);
            mainContext.fillText(text, mainCanvas.width-3, 3);
            mainContext.fillStyle = '#fff';
            mainContext.fillText(text, mainCanvas.width-2,2);
            drawCount = 0;
        }

        // copy anything left in the buffer if necessary
        glCopyToContext(mainContext);
    }
    //tileimage.src = 'vinecommit.png';
    tileImage.src = 'data:image/png;base64,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';
}

function engineUpdateObjects()
{
    // recursive object update
    const updateObject = (o)=>
    {
        if (!o.destroyed)
        {
            o.update();
            for(const child of o.children)
                updateObject(child);
        }
    }
    for(const o of engineObjects)
        o.parent || updateObject(o);
    engineObjects = engineObjects.filter(o=>!o.destroyed);
    engineCollideObjects = engineCollideObjects.filter(o=>!o.destroyed);
    time = ++frame / FPS;
}

function forEachObject(pos, size=0, callbackFunction=(o)=>1, collideObjectsOnly=1)
{
    const objectList = collideObjectsOnly ? engineCollideObjects : engineObjects;
    if (!size)
    {
        // no overlap test
        for (const o of objectList)
            callbackFunction(o);
    }
    else if (size.x != undefined)
    {
        // aabb test
        for (const o of objectList)
            isOverlapping(pos, size, o.pos, o.size) && callbackFunction(o);
    }
    else
    {
        // circle test
        const sizeSquared = size**2;
        for (const o of objectList)
            pos.distanceSquared(o.pos) < sizeSquared && callbackFunction(o);
    }
}
