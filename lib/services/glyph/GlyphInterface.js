define([
    'Atem-Errors/errors'
  , 'Atem-CPS/emitterMixin'
], function(
    errors
  , emitterMixin
) {
    "use strict";
    /* jshint esnext:true */

    var svgns = 'http://www.w3.org/2000/svg'
      , KeyError = errors.Key
      , emitterMixinSetup = {
            stateProperty: '_channel'
          , onAPI: 'on'
          , offAPI: 'off'
          , triggerAPI: '_trigger'
        }
      ;


    /**
     * This will become something like a layer-renderer API ...
     *
     * At the moment the default/normal use case is to just render glyph within
     * an svg element.
     *
     * When calling
     *      this.switchLayers(true);
     * the item changes to switch
     * on mouseenter to a display model where individual mom-nodes can
     * be selected via mouse click.
     * To receive notification of that selection you got to register a callback:
     *      this.on('select-mom', callback[, mydata])
     * where
     *      function callback(mydata or undefined, 'select-mom', selectedMOMNode){}
     *
     *
     * It is very gross in design at the moment. When I know more about
     * our diverse rendering needs there will be a refactoring. Until
     * then maybe you can tell us your wishlist in the issue tracker.
     * I'm thinking something roughly like a MOM GUI Toolkit with modular
     * reusable objects.
     *
     * TODO: make dependencies more explicit.
     */
    function GlyphInterface(document, layers, glyph, options_) {
        emitterMixin.init(this, emitterMixinSetup);


        // TODO: mak these public properties read only
        this._doc = this.document = document;
        this._mom = this.glyph = glyph;
        this.element = this._createElement();

        var options = options_ || {};

        this._container = this._doc.createElementNS(svgns, 'g');
        this._nodeIds2Mom = Object.create(null);
        this._listenTo(this._mom, this.element);
        this.element.appendChild(this._container);


        // Concerned with keeping the box size in sync with the glyph
        this._setViewBox(this._getViewBox());
        this._subscriptionId = this._mom.on('CPS-change', [this, '_cpsChangeHandler']);
        // Needs subscription to fontinfo when we start to change that ...
        this._transformation = null;
        this._setTransformation(glyph);

        // concerned with the display content of the element
        this._layers = layers;
        this._currentLayers = null;
        this._currentDisplaySet = null;
        this._displaySets = {
            simple: ['full']
          , detailed: ['shapes', 'centerline', 'meta', 'points', 'cpsui']
        };

        this.__selectNodeHandler = this._selectNodeHandler.bind(this);

        // default;
        if(options.showControls)
            this.showControls();
        else
            this.hideControls();

    }

    var _p = GlyphInterface.prototype;
    _p.constructor = GlyphInterface;
    emitterMixin(_p, emitterMixinSetup);

    _p.showControls = function() {
        this._switchDisplaySet('detailed');
        this.element.addEventListener('click', this.__selectNodeHandler);
    };

    _p.hideControls = function() {
        this._switchDisplaySet('simple');
        this.element.removeEventListener('click', this.__selectNodeHandler);
    };

    _p._makeLayer = function(key) {
        var layerElement, subscription, result, init
          , layer = this._layers[key]
          ;
        // There are two possible layer definitions
        //  *  An array is expected to have a [createFunction, destroyFunction]
        //      interface.
        //  * otherwise a `get(glyph)` function is expected with a return
        //      value that has a `value` property, the layerElement and a
        //      `destroy` method.
        if(layer instanceof Array) {
            init = layer[0];
            result = init(this, key);
            layerElement = result[0];
        }
        else {
            subscription = layer.get(this.glyph);
            layerElement = subscription.value;
            result = [layerElement, subscription];
        }
        layerElement.classList.add('layer', 'layer-'+key);
        return result;
    };

    _p._destroyLayers = function(layersState) {
        var i, l, key, data, destroy, state, layer;
        for(i=0,l=layersState.length;i<l;i++) {
            data = layersState[i];
            key = data[0];
            state = data[1];
            layer = this._layers[key];
            if(layer instanceof Array) {
                destroy = layer[1];
                destroy.apply(null, [this].concat(state));
            }
            else
                state[1].destroy();
        }
    };

    _p._makeLayers = function (keys) {
        var i, l, k,layer
          , layers = []
          ;
        for(i=0,l=keys.length;i<l;i++) {
            k = keys[i];
            layer = [k, this._makeLayer(k)];
            layers.push(layer);
        }
        return layers;
    };

    _p._switchDisplaySet = function(displaySet) {
        var oldSubscriptions;
        if(this._currentDisplaySet === displaySet)
            return;
        this._currentDisplaySet = displaySet;
        oldSubscriptions = this._currentLayers;

        // build new
        this._currentLayers = this._makeLayers(this._displaySets[displaySet]);
        this._currentLayers.forEach(
                    function(item){ this.appendChild(item[1][0]); }
                  , this._container);

        // clean up late, so that caches don't get
        // pruned and reloaded just a moment later
        if(oldSubscriptions) {
            this._destroyLayers(oldSubscriptions);
            // Avoid a flash of no layer content by removing to old elements
            // after adding the new ones.
            oldSubscriptions.forEach(
                    function(item){ this.removeChild(item[1][0]); }
                  , this._container);
        }
    };

    _p._registerMomNode = function(momNode) {
        // TODO: A "give me the nodeID I return the node item" facility
        // should probably become part of the Node API.
        var entry = this._nodeIds2Mom[momNode.nodeID];
        if(!entry)
            entry = this._nodeIds2Mom[momNode.nodeID] = [0, momNode];
        entry[0] += 1;
    };

    _p._unregisterMomNode = function(momNode) {
        var entry = this._nodeIds2Mom[momNode.nodeID];
        if(!entry) return;
        entry[0] -= 1;
        if(entry[0] <= 0)
            delete this._nodeIds2Mom[momNode.nodeID];
    };

    _p._getRegisteredMomNode = function(nodeID) {
        var entry = this._nodeIds2Mom[nodeID];
        if(!entry)
            throw new KeyError('MOM-Node with nodeID '+ nodeID + 'not found.');
        return entry[1];
    };

    _p._listenTo = function(momNode, dom) {
        dom.setAttribute('data-node-id', momNode.nodeID);
        this._registerMomNode(momNode);
    };

    _p._selectNodeHandler = function(event) {
        var elem = event.target;
        if(event.defaultPrevented) return;
        while(true) {
            if(elem === this.element.parentElement || !elem)
                return;
            if(elem.hasAttribute('data-node-id'))
                // found!
                break;
            elem = elem.parentElement;
        }
        event.preventDefault();
        var id = elem.getAttribute('data-node-id')
          , mom = this._getRegisteredMomNode(id)
          ;
        this._trigger('select-mom', mom);
    };

    _p._cpsChangeHandler = function(ownData, channel, eventData) {
        //jshint unused: vars
        var viewBox = this._getViewBox();
        if(this._viewBox.join(' ') !== viewBox.join(' ')) {
            this._setViewBox(viewBox);
            this._trigger('viewBox-change', viewBox);
        }
    };

    _p._setViewBox = function(viewbox) {
        this._viewBox = viewbox;
        this.element.setAttribute('viewBox', this._viewBox.join(' '));
    };

    /**
     * FIXME: MOM.master.fontinfo.unitsPerEm must be subscribed to in
     * the future, when we start changing it!
     *
     * updating "advanceWidth" is already covered by the normal redraw flow.
     *
     * For horizontal written languages:
     *      width is advanceWidth
     *      height is should the font height (fontinfo.unitsPerEm)
     */
    _p._getViewBox = function() {
        var styledict = this._mom.getComputedStyle()
          , width
          , height = this._getFontInfo(this._mom.master).unitsPerEm || 1000
          ;

        try {
            width = styledict.get('width');
        }
        catch(e){
            if(!(e instanceof KeyError))
                throw e;
            // FIXME: we should inform the user of this problem
            width = height;
        }
        // ViewBox min width can't be less than 0.
        width = Math.max(0, width);
        height = Math.max(0, height);

        return [0, 0, width, height];
    };

    _p._getFontInfo = function ( master ) {
        return master.getAttachment('fontinfo', true) || {};
    };

    _p._getTransformation = function ( master ) {
        // FIXME: * One day we have to subscribe to unitsPerEm AND
        //          descender for this!
        //        * I guess this is only valid for horizontal writing systems.
        //        * Maybe moveUp is rather === ascender?
        // ascender can be < fontinfo.unitsPerEm - fontinfo.descender, then
        // this solution is better. It seems OK to give the font enough
        // room down and maximal room upwards.
        var fontinfo = this._getFontInfo(master)
          , moveUp = (fontinfo.unitsPerEm || 1000) + (fontinfo.descender || 0)
          , matrix = [1, 0, 0, -1, 0, moveUp]
          ;
        return matrix.join(',');
    };

    /**
     * Returns true when the transformation actually changed otherwise false
     */
    _p._setTransformation = function(mom) {
        var transformation = this._getTransformation(mom.master);
        if(this._transformation === transformation)
            return false;
        this._transformation = transformation;
        // this transformation is evil! it breaks using transformation for
        // components
        this._container.setAttribute('transform', 'matrix(' +  transformation + ')');
        return true;
    };

    _p._createElement = function() {
        var svg = this._doc.createElementNS(svgns, 'svg');
        // This can be set via css as well, but since it is the only
        // choice that really makes sense, we may be happy for ever when
        // setting it here
        svg.setAttribute('overflow', 'visible');

        // Using inline-block fails for Chromium. Filed a bug:
        // https://code.google.com/p/chromium/issues/detail?id=462107
        // thus, these svgs should be packed inside a container that is
        // display: inline-block
        svg.style.display = 'block';
        return svg;
    };

    _p.destroy = function() {
        this._destroyLayers(this._currentLayers);
        this._mom.off(this._subscriptionId);
    };

    return GlyphInterface;
});
