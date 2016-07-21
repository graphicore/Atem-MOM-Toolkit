define([
], function(
) {
    "use strict";

    var svgns = 'http://www.w3.org/2000/svg';

    function makeLabelText(momNode) {
        var label = [
                momNode.type
              , ':i('+ momNode.index +')'
          ]
          , classes = momNode.classes
          , i, l
          ;

        if(momNode.id)
            label.push('#' + momNode.id);

        for(i=0,l=classes.length;i<l;i++)
            label.push('.' + classes[i]);

        // we currently have no better way to show classes of penstroke point
        // because these are not directly represented in the interface.
        // That will change when <center> will be removed an <point> will
        // take over it's duties. (which name will be kept is not decided yet)
        // https://github.com/metapolator/metapolator/issues/323#issuecomment-72224480
        if(momNode.parent.type === 'point')
            label.unshift(makeLabelText(momNode.parent) + ' ');
        return label.join('');
    }

    function setTitle ( momNode, dom ) {
        var label = makeLabelText(momNode)
          , title = dom.ownerDocument.createElementNS(svgns, 'title')
          ;
        title.appendChild(dom.ownerDocument.createTextNode(label));
        dom.appendChild(title);
    }

    // Maybe, instead of trigger, a 'selectNode' method could be passed,
    // or `nodeClicked` ?
    // At some point the semantic mapping from cause to effect needs to take
    // place.
    function selectNodeHandler(hostElement, subscription, trigger, event) {
        var elem = event.target
          , items = subscription.items
          ;
        if(event.defaultPrevented) return;
        while(true) {
            if(elem === hostElement.parentElement || !elem)
                return;
            if(elem.hasAttribute('data-shape-index'))
                // found!
                break;
            elem = elem.parentElement;
        }

        event.preventDefault();
        var index = elem.getAttribute('data-shape-index')
          , mom = items[index].mom
          ;
        trigger(mom);
    }

    function init (shapesService, layer, momGlyph) {
        var subscription = {
                items: []
              , elementClick: null
            }
          , items = subscription.items
          , children = momGlyph.children
          , child, i, l, item, dom
          ;

        for(i=0,l=children.length;i<l;i++) {
            child = children[i];
            item = shapesService.get(child);
            dom = item.value;
            setTitle(child, dom);
            dom.classList.add('type-' + child.type);
            dom.setAttribute('data-shape-index', items.length);
            layer.appendChild(dom);
            items.push({mom:child, subscription:item});
        }
        return subscription;
    }

    function create (shapesService, glyphInterface) {
        var layerElement = glyphInterface.document.createElementNS(svgns, 'g')
          , subscription = init(shapesService, layerElement, glyphInterface.glyph)
           // FIXME! private API
           // NOTE: maybe in the futer we could configure the event OR
           //       make a description so that we can rewire it, in a sense,
           //       live from within the application
          , trigger = glyphInterface._trigger.bind(glyphInterface, 'select-mom')
          ;
        subscription.elementClick = selectNodeHandler.bind(
                                    null
                                  , glyphInterface.element
                                  , subscription
                                  , trigger);
        glyphInterface.element.addEventListener(
                        'click', subscription.elementClick);

        return [layerElement, subscription];
    }

    function destroy(glyphInterface, layerElement, subscription) {
        var i,l, item;

        glyphInterface.element.removeEventListener(
                        'click', subscription.elementClick);

        for(i=0,l=subscription.items.length;i<l;i++) {
            item = subscription.items[i];
            item.subscription.destroy();
        }
    }

    return function factory (shapesService) {
        return {
            create: function(glyphInterface){
                return create(shapesService, glyphInterface);
            }
          , destroy: destroy
        };
    };
});
